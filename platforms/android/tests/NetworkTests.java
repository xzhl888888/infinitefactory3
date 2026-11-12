package com.geometryworkshop.wxgc3;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.net.ssl.*;
import java.util.concurrent.*;

/** 仅把本机假服务测试证书放入本次JVM的信任库；APK生产代码从不改变系统TLS验证。 */
public final class NetworkTests {
    public static void main(String[] args)throws Exception{
        Path directory=Paths.get(args[0]);KeyStore trusted=KeyStore.getInstance("PKCS12");try(InputStream in=Files.newInputStream(directory.resolve("localhost.p12"))){trusted.load(in,"wxgc3-fixture-only".toCharArray());}TrustManagerFactory factory=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());factory.init(trusted);SSLContext ssl=SSLContext.getInstance("TLS");ssl.init(null,factory.getTrustManagers(),null);HttpsURLConnection.setDefaultSSLSocketFactory(ssl.getSocketFactory());
        JSONObject fixture=SaveCodec.parse(new String(Files.readAllBytes(directory.resolve("fixture.json")),StandardCharsets.UTF_8));SaveCodec codec=new SaveCodec(SaveCodec.obj(fixture.opt("catalog")));AiClient client=new AiClient(codec);String port=new String(Files.readAllBytes(directory.resolve("network-port.txt")),StandardCharsets.UTF_8).trim(),base="https://127.0.0.1:"+port;JSONArray bases=SaveCodec.arr(codec.catalog.opt("bases"),5),materials=new JSONArray().put(bases.opt(0)).put(bases.opt(0));
        JSONObject good=client.generate(SaveCodec.record("baseUrl",base+"/good","model","fixture-model"),"fixture-not-real",materials,new AiClient.Request());ContractTests.check("测试火山".equals(good.opt("name")));
        String customPrompt="  用童话风格创作。\n简介是一句短诗。\t";
        client.generate(SaveCodec.record("baseUrl",base+"/theme","model","fixture-model"),"fixture-not-real",materials,new JSONArray().put("苔光花园世界主题"),customPrompt,new AiClient.Request());
        ContractTests.error("INVALID_SAVE",()->client.generate(SaveCodec.record("baseUrl",base+"/invalid-prompt","model","fixture-model"),"fixture-not-real",materials,new JSONArray(),"坏\u0000提示",new AiClient.Request()));
        String[][] errors={{"redirect","REDIRECT_REJECTED"},{"unauthorized","AUTH_FAILED"},{"large","RESPONSE_TOO_LARGE"},{"invalid","INVALID_RESPONSE"}};
        for(String[] test:errors)ContractTests.error(test[1],()->client.generate(SaveCodec.record("baseUrl",base+"/"+test[0],"model","fixture-model"),"fixture-not-real",materials,new AiClient.Request()));
        ContractTests.error("REQUEST_FAILED",()->client.generate(SaveCodec.record("baseUrl","https://localhost:"+port+"/host-mismatch","model","fixture-model"),"fixture-not-real",materials,new AiClient.Request()));
        AiClient.Request pending=new AiClient.Request();ScheduledExecutorService cancel=Executors.newSingleThreadScheduledExecutor();cancel.schedule(()->pending.cancel(),250,TimeUnit.MILLISECONDS);ContractTests.error("CANCELLED",()->client.generate(SaveCodec.record("baseUrl",base+"/delay","model","fixture-model"),"fixture-not-real",materials,pending));cancel.shutdownNow();
        client.close();JSONArray hits=SaveCodec.parseArray(new String(Files.readAllBytes(directory.resolve("network-hits.json")),StandardCharsets.UTF_8));ContractTests.check(hits.length()==7);
        for(int i=0;i<hits.length();i++){JSONObject hit=SaveCodec.obj(hits.opt(i));ContractTests.check("POST".equals(hit.opt("method"))&&Boolean.TRUE.equals(hit.opt("fixtureAuthenticated"))&&!SaveCodec.str(hit.opt("path")).contains("trap"));JSONObject body=SaveCodec.obj(hit.opt("body"));ContractTests.check(!body.has("thinking")&&Boolean.FALSE.equals(body.opt("stream")));JSONArray messages=SaveCodec.arr(body.opt("messages"),2);JSONObject content=SaveCodec.parse(SaveCodec.str(SaveCodec.obj(messages.opt(1)).opt("content")));JSONArray ms=SaveCodec.arr(content.opt("materials"),4);ContractTests.check(ms.length()==2&&SaveCodec.same(ms.opt(0),ms.opt(1)));boolean custom=SaveCodec.str(hit.opt("path")).startsWith("/theme/");ContractTests.check(client.systemPrompt(custom?customPrompt:"").equals(SaveCodec.obj(messages.opt(0)).opt("content")));if(custom)ContractTests.check("苔光花园世界主题".equals(SaveCodec.arr(content.opt("worldThemes"),16).opt(0)));}
        JSONObject result=SaveCodec.record("passed",ContractTests.checks,"requestsObserved",hits.length(),"redirectsFollowed",0,"provider","loopback HTTPS fixture only","realKeyUsed",false);Files.write(directory.resolve("network-results.json"),result.toString().getBytes(StandardCharsets.UTF_8));System.out.println(result.toString());
    }
}
