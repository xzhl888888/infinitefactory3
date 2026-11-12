package com.geometryworkshop.wxgc3;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.*;
import javax.net.ssl.HttpsURLConnection;

final class AiClient {
    final SaveCodec codec;
    private final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();
    static final class Request {
        volatile boolean cancelled,timedOut;
        volatile HttpsURLConnection connection;
        void cancel(){cancelled=true;HttpsURLConnection c=connection;if(c!=null)c.disconnect();}
        void check(){if(timedOut)throw new Fault("REQUEST_TIMEOUT");if(cancelled)throw new Fault("CANCELLED");}
    }
    AiClient(SaveCodec codec){this.codec=codec;}
    static JSONObject normalizeConfig(JSONObject raw){
        String base=SaveCodec.str(raw.opt("baseUrl")).trim(),model=SaveCodec.str(raw.opt("model")).trim();
        Fault.require(!base.isEmpty()&&base.length()<=2048&&!base.matches("(?s).*"+SaveCodec.CONTROLS+".*"),"INVALID_CONFIG");Fault.require(!model.isEmpty()&&model.codePointCount(0,model.length())<=128&&!model.matches("(?s).*"+SaveCodec.CONTROLS+".*"),"INVALID_CONFIG");
        try{URI uri=new URI(base);Fault.require("https".equalsIgnoreCase(uri.getScheme())&&uri.getHost()!=null&&!uri.isOpaque(),"AI_HTTPS_REQUIRED");Fault.require(uri.getRawUserInfo()==null&&uri.getRawQuery()==null&&uri.getRawFragment()==null,"AI_BASE_URL_HAS_CREDENTIALS_OR_QUERY");String path=uri.getRawPath();while(path.endsWith("/"))path=path.substring(0,path.length()-1);Fault.require(!path.toLowerCase(Locale.ROOT).endsWith("/chat/completions"),"AI_BASE_URL_IS_ENDPOINT");Fault.require(!path.contains("\\")&&!path.contains("/../")&&!path.contains("/./"),"INVALID_CONFIG");String host=uri.getHost().toLowerCase(Locale.ROOT);if(host.indexOf(':')>=0&&!host.startsWith("["))host="["+host+"]";int port=uri.getPort();Fault.require(port==-1||(port>=1&&port<=65535),"INVALID_CONFIG");String normalized="https://"+host+((port!=-1&&port!=443)?":"+port:"")+path;return SaveCodec.record("baseUrl",normalized,"model",model);}catch(Fault e){throw e;}catch(Exception e){throw new Fault("INVALID_CONFIG");}
    }
    static String validKey(String raw){String key=raw.trim();Fault.require(!key.isEmpty()&&key.length()<=8192&&key.matches("[!-~]+"),"INVALID_KEY");return key;}
    JSONObject generate(JSONObject config,String key,JSONArray materials,Request request){
        return generate(config,key,materials,new JSONArray(),request);
    }
    JSONObject generate(JSONObject config,String key,JSONArray materials,JSONArray themes,Request request){
        return generate(config,key,materials,themes,"",request);
    }
    // 默认正文及固定协议由JS模块生成到catalog，避免Windows与安卓各自维护另一套提示。
    String systemPrompt(String customPrompt){
        String custom=codec.synthesisPrompt(customPrompt);JSONObject prompt=SaveCodec.obj(codec.catalog.opt("prompt"));
        return (custom.isEmpty()?SaveCodec.str(prompt.opt("default")):custom)+"\n\n"+SaveCodec.str(prompt.opt("outputRules"));
    }
    JSONArray messages(JSONArray materials,JSONArray themes,String customPrompt){
        Fault.require(materials.length()>=2&&materials.length()<=4,"INVALID_INGREDIENT_COUNT");JSONArray cards=new JSONArray();for(int i=0;i<materials.length();i++)cards.put(codec.card(materials.opt(i)));
        JSONObject input=SaveCodec.record("materials",cards);if(themes.length()>0){Fault.require(themes.length()<=16,"INVALID_MOD");JSONArray cleanThemes=new JSONArray();for(int i=0;i<themes.length();i++){String theme=ModCodec.text(themes.opt(i),1200,true);if(theme.length()>1200)theme=theme.substring(0,1200);cleanThemes.put(theme);}SaveCodec.put(input,"worldThemes",cleanThemes);}
        JSONArray messages=new JSONArray();messages.put(SaveCodec.record("role","system","content",systemPrompt(customPrompt)));messages.put(SaveCodec.record("role","user","content",input.toString()));return messages;
    }
    JSONObject generate(JSONObject config,String key,JSONArray materials,JSONArray themes,String customPrompt,Request request){
        request.check();key=validKey(key);JSONObject clean=normalizeConfig(config);
        JSONObject body=SaveCodec.record("model",clean.opt("model"),"messages",messages(materials,themes,customPrompt),"stream",false,"max_tokens",1024,"response_format",SaveCodec.record("type","json_object"));
        try{if("api.deepseek.com".equals(new URI(SaveCodec.str(clean.opt("baseUrl"))).getHost()))SaveCodec.put(body,"thinking",SaveCodec.record("type","disabled"));}catch(Exception e){throw new Fault("INVALID_CONFIG");}
        byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);Fault.require(bytes.length<=128*1024,"INVALID_CONFIG");
        ScheduledFuture<?> deadline=deadlines.schedule(()->{request.timedOut=true;HttpsURLConnection c=request.connection;if(c!=null)c.disconnect();},60,TimeUnit.SECONDS);
        HttpsURLConnection connection=null;
        try{
            connection=(HttpsURLConnection)new URI(SaveCodec.str(clean.opt("baseUrl"))+"/chat/completions").toURL().openConnection();request.connection=connection;request.check();
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(60000);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setUseCaches(false);connection.setFixedLengthStreamingMode(bytes.length);
            connection.setRequestProperty("Authorization","Bearer "+key);connection.setRequestProperty("Content-Type","application/json; charset=utf-8");connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Connection","close");
            try(OutputStream out=connection.getOutputStream()){request.check();out.write(bytes);}int status=connection.getResponseCode();request.check();
            if(status<200||status>=300){String code=status>=300&&status<400?"REDIRECT_REJECTED":status==401||status==403?"AUTH_FAILED":status==402?"NO_BALANCE":status==404?"MODEL_NOT_FOUND":status==429?"RATE_LIMITED":status==408||status==504?"REQUEST_TIMEOUT":status>=500?"SERVER_ERROR":"REQUEST_FAILED";throw new Fault(code);}
            long length=connection.getContentLengthLong();Fault.require(length<=1024*1024,"RESPONSE_TOO_LARGE");byte[] response;try(InputStream in=connection.getInputStream()){response=PrivateFiles.read(in,1024*1024,"RESPONSE_TOO_LARGE");}request.check();
            JSONObject result=parseResponse(new String(response,StandardCharsets.UTF_8));
            // 厂商响应也按不可信内容处理，不允许回显完整Key到页面或可分享卡牌。
            rejectKeyEcho(result,key);return result;
        }catch(Fault e){throw e;}catch(SocketTimeoutException e){throw new Fault("REQUEST_TIMEOUT");}catch(Exception e){request.check();throw new Fault("REQUEST_FAILED");}finally{deadline.cancel(false);request.connection=null;if(connection!=null)connection.disconnect();}
    }
    static void rejectKeyEcho(JSONObject result,String key){for(String field:new String[]{"name","emoji","category","description"})Fault.require(!SaveCodec.str(result.opt(field)).contains(key),"AI_SENSITIVE_RESPONSE");}
    JSONObject parseResponse(String text){
        try{JSONObject envelope=SaveCodec.parse(text);Fault.require(envelope.isNull("error"),"INVALID_RESPONSE");JSONArray choices=SaveCodec.arr(envelope.opt("choices"),100);Fault.require(choices.length()>0,"INVALID_RESPONSE");JSONObject choice=SaveCodec.obj(choices.opt(0));Object finish=choice.opt("finish_reason");if("length".equals(finish))throw new Fault("AI_OUTPUT_TRUNCATED");if("content_filter".equals(finish))throw new Fault("AI_RESPONSE_REFUSED");Fault.require(finish==null||finish==JSONObject.NULL||"stop".equals(finish),"INVALID_RESPONSE");JSONObject message=SaveCodec.obj(choice.opt("message"));Fault.require(message.isNull("refusal")||"".equals(message.opt("refusal")),"AI_RESPONSE_REFUSED");Object calls=message.opt("tool_calls");Fault.require(calls==null||calls==JSONObject.NULL||(calls instanceof JSONArray&&((JSONArray)calls).length()==0),"AI_RESPONSE_REFUSED");String content=SaveCodec.str(message.opt("content")).replaceAll("^"+SaveCodec.WS+"|"+SaveCodec.WS+"$","");Fault.require(content.getBytes(StandardCharsets.UTF_8).length<=32768,"RESPONSE_TOO_LARGE");if(content.startsWith("```")&&content.endsWith("```")){content=content.substring(3,content.length()-3);if(content.toLowerCase(Locale.ROOT).startsWith("json"))content=content.substring(4);content=content.trim();}return codec.card(SaveCodec.parse(content));}
        catch(Fault e){if(e.code.startsWith("AI_")||"RESPONSE_TOO_LARGE".equals(e.code)||"INVALID_CARD_RESULT".equals(e.code))throw e;throw new Fault("INVALID_RESPONSE");}
    }
    void close(){deadlines.shutdownNow();}
}
