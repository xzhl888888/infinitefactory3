package com.geometryworkshop.wxgc3;

import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;

/** 仅在主机JVM运行；不打进APK，不持有真实凭据或连接真实供应商。 */
public final class ContractTests {
    static int checks=0;
    static void check(boolean value){checks++;if(!value)throw new AssertionError("contract assertion "+checks);}
    static void error(String expected,Runnable action){checks++;try{action.run();throw new AssertionError("missing "+expected);}catch(Fault f){if(!expected.equals(f.code))throw new AssertionError(expected+" != "+f.code);}}
    public static void main(String[] args)throws Exception{
        Path directory=Paths.get(args[0]);JSONObject fixture=SaveCodec.parse(new String(Files.readAllBytes(directory.resolve("fixture.json")),StandardCharsets.UTF_8));SaveCodec codec=new SaveCodec(SaveCodec.obj(fixture.opt("catalog")));JSONArray saves=new JSONArray(),transitions=new JSONArray();
        JSONArray cases=SaveCodec.arr(fixture.opt("cases"),100);for(int i=0;i<cases.length();i++){JSONObject test=SaveCodec.obj(cases.opt(i)),out=SaveCodec.record("label",test.opt("label"));try{SaveCodec.put(out,"save",codec.validate(test.opt("save")));}catch(Fault f){SaveCodec.put(out,"error",f.code);}saves.put(out);}
        cases=SaveCodec.arr(fixture.opt("transitions"),100);for(int i=0;i<cases.length();i++){JSONObject test=SaveCodec.obj(cases.opt(i)),out=SaveCodec.record("label",test.opt("label"));try{SaveCodec.put(out,"clear",codec.transition(codec.validate(test.opt("current")),codec.validate(test.opt("next")),test.isNull("pending")?null:SaveCodec.obj(test.opt("pending"))));}catch(Fault f){SaveCodec.put(out,"error",f.code);}transitions.put(out);}
        JSONArray modCases=new JSONArray();cases=SaveCodec.arr(fixture.opt("modCases"),100);for(int i=0;i<cases.length();i++){JSONObject test=SaveCodec.obj(cases.opt(i)),out=SaveCodec.record("label",test.opt("label"));try{Object value=null,input=test.opt("input");JSONArray mods=test.has("mods")?SaveCodec.arr(test.opt("mods"),16):null;switch(SaveCodec.str(test.opt("kind"))){case "package":value=codec.modCodec.validatePackage(input);break;case "mods":value=codec.modCodec.mods(input);break;case "state":value=codec.modCodec.state(input);break;case "states":value=codec.modCodec.states(input,mods);break;case "source":value=codec.modCodec.source(input,mods);break;default:throw new AssertionError("unknown mod test");}SaveCodec.put(out,"value",value);}catch(Fault f){SaveCodec.put(out,"error",f.code);}modCases.put(out);}
        AiClient ai=new AiClient(codec);JSONObject card=SaveCodec.record("name","火山","emoji","🌋","category","自然","description","熔岩汇聚的山。"),message=SaveCodec.record("content",card.toString());JSONObject envelope=SaveCodec.record("choices",new JSONArray().put(SaveCodec.record("message",message,"finish_reason","stop")));
        // 直接对照正式JS生成的消息；除了JSON对象的键顺序，两端请求须逐项一致。
        JSONArray prompts=SaveCodec.arr(fixture.opt("promptCases"),10);for(int i=0;i<prompts.length();i++){JSONObject test=SaveCodec.obj(prompts.opt(i));JSONArray actual=ai.messages(SaveCodec.arr(test.opt("materials"),4),SaveCodec.arr(test.opt("themes"),16),SaveCodec.str(test.opt("custom"))),expected=SaveCodec.arr(test.opt("expected"),2);check(SaveCodec.same(actual.opt(0),expected.opt(0)));check(SaveCodec.obj(actual.opt(1)).opt("role").equals(SaveCodec.obj(expected.opt(1)).opt("role")));check(SaveCodec.same(SaveCodec.parse(SaveCodec.str(SaveCodec.obj(actual.opt(1)).opt("content"))),SaveCodec.parse(SaveCodec.str(SaveCodec.obj(expected.opt(1)).opt("content")))));}
        check(SaveCodec.same(card,ai.parseResponse(envelope.toString())));SaveCodec.put(message,"content","```json\n"+card.toString()+"\n```");check(SaveCodec.same(card,ai.parseResponse(envelope.toString())));
        SaveCodec.put(message,"refusal","blocked");error("AI_RESPONSE_REFUSED",()->ai.parseResponse(envelope.toString()));SaveCodec.put(message,"refusal",JSONObject.NULL);
        SaveCodec.put(message,"tool_calls",new JSONArray().put(SaveCodec.record("id","tool")));error("AI_RESPONSE_REFUSED",()->ai.parseResponse(envelope.toString()));SaveCodec.put(message,"tool_calls",JSONObject.NULL);
        JSONObject choice=SaveCodec.obj(SaveCodec.arr(envelope.opt("choices"),100).opt(0));SaveCodec.put(choice,"finish_reason","length");error("AI_OUTPUT_TRUNCATED",()->ai.parseResponse(envelope.toString()));SaveCodec.put(choice,"finish_reason","stop");
        SaveCodec.put(message,"content","这里是结果 "+card.toString());error("INVALID_RESPONSE",()->ai.parseResponse(envelope.toString()));
        check("https://api.deepseek.com".equals(AiClient.normalizeConfig(SaveCodec.record("baseUrl","https://API.DEEPSEEK.COM:443/","model","deepseek-flash")).opt("baseUrl")));
        error("AI_HTTPS_REQUIRED",()->AiClient.normalizeConfig(SaveCodec.record("baseUrl","http://api.example.com","model","m")));
        for(String url:new String[]{"https://user@example.com","https://example.com?q=1","https://example.com/#x"})error("AI_BASE_URL_HAS_CREDENTIALS_OR_QUERY",()->AiClient.normalizeConfig(SaveCodec.record("baseUrl",url,"model","m")));
        error("AI_BASE_URL_IS_ENDPOINT",()->AiClient.normalizeConfig(SaveCodec.record("baseUrl","https://example.com/v1/chat/completions/","model","m")));
        error("INVALID_KEY",()->AiClient.validKey("fake key"));error("INVALID_KEY",()->AiClient.validKey("fáke"));
        String unusual="fixture-\\\"-only";SaveCodec.put(card,"description","结果包含 "+unusual);error("AI_SENSITIVE_RESPONSE",()->AiClient.rejectKeyEcho(card,unusual));
        check(SaveCodec.now().matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z"));
        ai.close();JSONObject output=SaveCodec.record("saves",saves,"transitions",transitions,"modCases",modCases,"protocolChecks",checks,"protocolFailures",0);Files.write(directory.resolve("results.json"),output.toString().getBytes(StandardCharsets.UTF_8));System.out.println("Shared model/protocol host cases complete; inspect Node comparison.");
    }
}
