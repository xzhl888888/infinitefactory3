package com.geometryworkshop.wxgc3;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** 页面只绘制游戏。文件、凭据、HTTPS与事务都在白名单桥接后的原生层执行。 */
public final class MainActivity extends Activity {
    private static final String ORIGIN="https://appassets.androidplatform.net";
    private static final String CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self'; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
    private static final Set<String> COMMANDS=new HashSet<>(Arrays.asList("usage_notice","exit_game","load_save","initialize_save","save_snapshot","config_status","configure_ai","generate_card","cancel_request","export_save_file","choose_import_file","confirm_import","import_save","load_pending","recovery_status","list_backups","restore_backup","library_status","create_slot","switch_slot","rename_slot","import_as_slot","stage_mod_result","update_pending","choose_mod_file"));
    private static final Set<String> MUTATIONS=new HashSet<>(Arrays.asList("initialize_save","save_snapshot","configure_ai","generate_card","import_save","restore_backup","create_slot","switch_slot","rename_slot","import_as_slot","stage_mod_result","update_pending"));
    private static final int EXPORT=301,IMPORT=302,MOD_IMPORT=303;
    private final ExecutorService work=Executors.newSingleThreadExecutor();
    private final Object requestLock=new Object();
    private WebView web;
    private SaveCodec codec;
    private GameLibrary library;
    private SecretVault vault;
    private AiClient ai;
    private AiClient.Request activeRequest;
    private volatile boolean destroyed;
    private Object fileRequestId;
    private byte[] exportBytes;
    private volatile boolean dialogActive;

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        android.content.pm.PackageInfo engine=WebView.getCurrentWebViewPackage();int engineMajor=0;
        try{if(engine!=null&&engine.versionName!=null)engineMajor=Integer.parseInt(engine.versionName.split("\\.")[0]);}catch(Exception ignored){}
        // structuredClone需要Chromium98；旧系统出厂WebView不能只靠Android版本判定可运行。
        if(engineMajor<98){new AlertDialog.Builder(this).setTitle("需要更新网页组件").setMessage("请先更新 Android System WebView 或系统浏览器，再打开游戏。").setPositiveButton("关闭",(d,w)->finish()).setCancelable(false).show();return;}
        try(InputStream in=getAssets().open("native-catalog.json")){codec=new SaveCodec(SaveCodec.parse(new String(PrivateFiles.read(in,65536,"INVALID_SAVE"),StandardCharsets.UTF_8)));}catch(Exception e){new AlertDialog.Builder(this).setMessage("游戏文件无法读取，请重新安装。").setPositiveButton("关闭",(d,w)->finish()).setCancelable(false).show();return;}
        vault=new SecretVault(this);ai=new AiClient(codec);
        web=new WebView(this);WebView.setWebContentsDebuggingEnabled(false);WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(false);s.setDatabaseEnabled(false);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setAllowFileAccessFromFileURLs(false);s.setAllowUniversalAccessFromFileURLs(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setJavaScriptCanOpenWindowsAutomatically(false);s.setSupportMultipleWindows(false);s.setMediaPlaybackRequiresUserGesture(true);s.setCacheMode(WebSettings.LOAD_NO_CACHE);s.setSafeBrowsingEnabled(true);s.setGeolocationEnabled(false);
        CookieManager.getInstance().setAcceptCookie(false);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);web.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        web.setBackgroundColor(0xfff3e9d7);web.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage message){return true;}});
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return asset(request.getUrl(),request.getMethod());}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !entry(request.getUrl());}
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return !entry(Uri.parse(url));}
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){if(!entry(Uri.parse(url))){view.removeJavascriptInterface("wxgcAndroid");view.stopLoading();}}
            @Override public void onReceivedSslError(WebView view,android.webkit.SslErrorHandler handler,android.net.http.SslError error){handler.cancel();}
        });
        web.addJavascriptInterface(new Bridge(),"wxgcAndroid");setContentView(web);
        // Android 15/16强制边到边；给游戏可用区域加系统安全边距，键盘由adjustResize处理。
        web.setOnApplyWindowInsetsListener((view,insets)->{if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);}else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        web.loadUrl(ORIGIN+"/index.html");
    }
    private boolean local(Uri uri){return "https".equals(uri.getScheme())&&"appassets.androidplatform.net".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443)&&uri.getUserInfo()==null&&uri.getQuery()==null;}
    private boolean entry(Uri uri){return local(uri)&&("/".equals(uri.getPath())||"/index.html".equals(uri.getPath()));}
    private WebResourceResponse asset(Uri uri,String method){
        if(!local(uri)||!"GET".equals(method))return blocked();String path=uri.getPath();if(path==null||path.equals("/"))path="/index.html";
        if(path.contains("..")||path.contains("\\")||path.contains("\u0000")||!path.startsWith("/")||path.contains("//"))return blocked();
        try{InputStream in=getAssets().open("web"+path);String mime=path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":path.endsWith(".html")?"text/html":path.endsWith(".json")?"application/json":path.endsWith(".png")?"image/png":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".ogg")?"audio/ogg":path.endsWith(".wav")?"audio/wav":path.endsWith(".mp3")?"audio/mpeg":"application/octet-stream";Map<String,String> headers=new HashMap<>();headers.put("Content-Security-Policy",CSP);headers.put("X-Content-Type-Options","nosniff");headers.put("Cache-Control","no-store");return new WebResourceResponse(mime,mime.startsWith("text/")||mime.equals("application/json")?"UTF-8":null,200,"OK",headers,in);}catch(Exception e){return blocked();}
    }
    private WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.singletonMap("Content-Security-Policy",CSP),new ByteArrayInputStream(new byte[0]));}
    private void respond(Object id,Object value,String error){
        if(destroyed)return;JSONObject response=error==null?SaveCodec.record("ok",true,"data",value):SaveCodec.record("ok",false,"error",error);String idJson=id instanceof Number?id.toString():JSONObject.quote(String.valueOf(id));
        // JSONObject序列化，不拼接用户文本为代码；转义JS行分隔符兼容旧WebView。
        String script="window.__wxgcReceive&&window.__wxgcReceive("+idJson+","+response.toString()+");";script=script.replace("\u2028","\\u2028").replace("\u2029","\\u2029");final String safe=script;
        runOnUiThread(()->{if(!destroyed&&web!=null&&entry(Uri.parse(web.getUrl()==null?"":web.getUrl())))web.evaluateJavascript(safe,null);});
    }
    private final class Bridge {
        @JavascriptInterface public void postMessage(String text){
            Object id=null;
            try{
                Fault.require(!destroyed,"CANCELLED");Fault.require(text!=null&&text.getBytes(StandardCharsets.UTF_8).length<=SaveCodec.MAX_BYTES+4096,"SAVE_TOO_LARGE");JSONObject message=SaveCodec.parse(text,SaveCodec.MAX_BYTES+4096);id=message.opt("id");Fault.require(id instanceof String&&((String)id).matches("[A-Za-z0-9._:-]{1,128}"),"INVALID_CONFIG");String command=SaveCodec.str(message.opt("command"));Fault.require(COMMANDS.contains(command),"INVALID_CONFIG");JSONObject args=message.isNull("args")?new JSONObject():SaveCodec.obj(message.opt("args"));final Object requestId=id;
                if("cancel_request".equals(command)){library.assertActive(args.opt("slotId"));synchronized(requestLock){if(activeRequest!=null)activeRequest.cancel();}work.execute(()->respond(requestId,true,null));return;}
                AiClient.Request token=null;
                synchronized(requestLock){
                    if(MUTATIONS.contains(command)){Fault.require(activeRequest==null,"BUSY");token=new AiClient.Request();activeRequest=token;}
                }
                final AiClient.Request request=token;
                work.execute(()->{Object result=null;String error=null;try{result=execute(requestId,command,args,request);}catch(Fault e){error=e.code;}catch(Exception e){error="STORAGE_ERROR";}finally{if(request!=null)synchronized(requestLock){if(activeRequest==request)activeRequest=null;}}if(result!=Deferred.VALUE||error!=null)respond(requestId,result,error);});
            }catch(Fault e){if(id!=null)respond(id,null,e.code);}catch(Exception e){if(id!=null)respond(id,null,"INVALID_CONFIG");}
        }
    }
    private enum Deferred { VALUE }
    private Object execute(Object id,String command,JSONObject args,AiClient.Request request){
        if("exit_game".equals(command)){runOnUiThread(this::finish);return Deferred.VALUE;}
        if("usage_notice".equals(command)){
            String version=SaveCodec.str(args.opt("version"));
            Fault.require(version.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") && args.opt("accept") instanceof Boolean,"INVALID_CONFIG");
            File marker=new File(getNoBackupFilesDir(),"usage-notice.txt");
            if(Boolean.TRUE.equals(args.opt("accept"))){
                PrivateFiles.writeAtomic(marker,version.getBytes(StandardCharsets.UTF_8),"NOTICE_WRITE_FAILED");
                return true;
            }
            if(!marker.exists() && !new File(marker.getPath()+".bak").exists())return false;
            return version.equals(new String(PrivateFiles.readAtomic(marker,64,"NOTICE_READ_FAILED"),StandardCharsets.UTF_8));
        }
        // 协议与全机档案无关，拒绝进入时无需打开或初始化玩家的存档。
        if(library==null)library=new GameLibrary(getNoBackupFilesDir(),codec);
        // 库列表用于取得槽令牌；共用设备凭据也必须来自当前页面，不能接受旧槽迟到的配置响应。
        if("library_status".equals(command))return library.status();
        library.assertActive(args.opt("slotId"));
        if("config_status".equals(command))return configStatus();
        if("configure_ai".equals(command))return configure(SaveCodec.obj(args.opt("config")),request);
        if(Arrays.asList("create_slot","switch_slot","rename_slot","import_as_slot").contains(command)){
            Fault.require(!dialogActive,"BUSY");
            switch(command){case "create_slot":return library.createSlot(args.opt("name"),SaveCodec.obj(args.opt("save")),false);case "import_as_slot":return library.createSlot(args.opt("name"),SaveCodec.obj(args.opt("save")),true);case "switch_slot":return library.switchSlot(args.opt("id"));case "rename_slot":return library.renameSlot(args.opt("id"),args.opt("name"));}
        }
        SlotStorage store=library.active(args.opt("slotId"));
        switch(command){
            case "load_save":return library.load(args.opt("slotId"));
            case "initialize_save":return library.withName(args.opt("slotId"),store.initialize(library.withName(args.opt("slotId"),SaveCodec.obj(args.opt("save")))));
            case "save_snapshot":return library.withName(args.opt("slotId"),store.save(library.withName(args.opt("slotId"),SaveCodec.obj(args.opt("save"))),SaveCodec.integer(args.opt("expectedRevision"))));
            case "load_pending":return store.loadPending();
            case "recovery_status":return library.recoveryStatus(args.opt("slotId"));
            case "list_backups":return store.listBackups();
            case "restore_backup":return library.withName(args.opt("slotId"),store.restore(SaveCodec.str(args.opt("id"))));
            case "generate_card":return generate(args,request,store);
            case "stage_mod_result":return stageMod(args,store,false);
            case "update_pending":return stageMod(args,store,true);
            case "import_save":throw new Fault("USE_IMPORT_AS_SLOT");
            case "export_save_file":{JSONObject save=library.load(args.opt("slotId"));Fault.require(save!=null,"INVALID_SAVE");showFile(id,EXPORT,save.toString().getBytes(StandardCharsets.UTF_8));return Deferred.VALUE;}
            case "choose_import_file":showFile(id,IMPORT,null);return Deferred.VALUE;
            case "choose_mod_file":showFile(id,MOD_IMPORT,null);return Deferred.VALUE;
            case "confirm_import":{
                long cards=SaveCodec.integer(args.opt("cardCount")),recipes=SaveCodec.integer(args.opt("recipeCount")),modCount=SaveCodec.integer(ModCodec.or(args.opt("modCount"),0)),scriptCount=SaveCodec.integer(ModCodec.or(args.opt("enabledScriptCount"),0));Fault.require(cards<=25000&&recipes<=100000&&modCount<=16&&scriptCount<=modCount,"INVALID_SAVE");
                String message="这份存档有 "+cards+" 张卡牌、"+recipes+" 条配方，将另存为一个独立世界。"+(scriptCount>0?"\n\n包含 "+scriptCount+" 个已启用玩法脚本，导入后会在这份存档中运行。":"");
                runOnUiThread(()->{if(dialogActive){respond(id,null,"BUSY");return;}dialogActive=true;new AlertDialog.Builder(this).setTitle("添加这份存档？").setMessage(message).setPositiveButton("添加",(d,w)->{dialogActive=false;respond(id,true,null);}).setNegativeButton("取消",(d,w)->{dialogActive=false;respond(id,false,null);}).setOnCancelListener(d->{dialogActive=false;respond(id,false,null);}).show();});return Deferred.VALUE;
            }
            default:throw new Fault("INVALID_CONFIG");
        }
    }
    private JSONObject configStatus(){
        JSONObject defaults=SaveCodec.obj(codec.catalog.opt("ai"));try{JSONObject secret=vault.read();if(secret!=null){JSONObject config=AiClient.normalizeConfig(SaveCodec.obj(secret.opt("config")));AiClient.validKey(SaveCodec.str(secret.opt("key")));return SaveCodec.record("configured",true,"keyAvailable",true,"baseUrl",config.opt("baseUrl"),"model",config.opt("model"));}}catch(Fault ignored){}
        return SaveCodec.record("configured",false,"previouslyConfigured",vault.configured(),"keyAvailable",false,"keyUnavailable",vault.configured(),"baseUrl",defaults.opt("baseUrl"),"model",defaults.opt("model"));
    }
    private JSONObject configure(JSONObject input,AiClient.Request request){
        JSONObject config=AiClient.normalizeConfig(input);String key=SaveCodec.str(input.opt("key")).trim();
        if(key.isEmpty()){JSONObject old=vault.read();Fault.require(old!=null,"KEY_REQUIRED");Fault.require(SaveCodec.obj(old.opt("config")).opt("baseUrl").equals(config.opt("baseUrl")),"SERVICE_CHANGED_KEY_REQUIRED");key=SaveCodec.str(old.opt("key"));}
        key=AiClient.validKey(key);JSONObject secret=SaveCodec.record("config",config,"key",key);Fault.require(secret.toString().getBytes(StandardCharsets.UTF_8).length<=8192,"CONFIG_TOO_LARGE");JSONArray sample=new JSONArray(),bases=SaveCodec.arr(codec.catalog.opt("bases"),5);sample.put(bases.opt(0));sample.put(bases.opt(1));ai.generate(config,key,sample,request);request.check();vault.write(secret);return SaveCodec.record("configured",true,"keyAvailable",true,"baseUrl",config.opt("baseUrl"),"model",config.opt("model"));
    }
    private JSONObject generate(JSONObject args,AiClient.Request request,SlotStorage store){
        JSONArray ids=SaveCodec.arr(args.opt("ingredientIds"),4);String key=SaveCodec.recipeKey(ids),op=SaveCodec.id(args.opt("operationId"));Fault.require(op.length()<=128,"INVALID_ID");JSONObject save=store.load();Fault.require(save!=null,"INVALID_SAVE");JSONObject pending=store.loadPending();if(pending!=null){Fault.require(op.equals(pending.opt("operationId"))&&key.equals(SaveCodec.recipeKey(pending.opt("ingredientIds"))),"BUSY");return SaveCodec.obj(pending.opt("result"));}
        JSONArray cards=SaveCodec.arr(save.opt("cards"),25000),recipes=SaveCodec.arr(save.opt("recipes"),100000);Map<String,JSONObject> byId=new HashMap<>();for(int i=0;i<cards.length();i++){JSONObject card=SaveCodec.obj(cards.opt(i));byId.put(SaveCodec.str(card.opt("id")),card);}
        JSONArray materials=new JSONArray();for(int i=0;i<ids.length();i++){JSONObject card=byId.get(SaveCodec.id(ids.opt(i)));Fault.require(card!=null,"UNKNOWN_INGREDIENT");materials.put(card);}for(int i=0;i<recipes.length();i++){JSONObject recipe=SaveCodec.obj(recipes.opt(i));if(key.equals(recipe.opt("key"))){JSONObject result=codec.card(byId.get(recipe.opt("resultId")));store.putPending(SaveCodec.record("saveId",save.opt("id"),"operationId",op,"ingredientIds",SaveCodec.parseArray(key),"result",result,"now",SaveCodec.now(),"source",SaveCodec.record("kind","recipe"),"modStates",new JSONArray(),"modProcessed",false));return result;}}
        JSONObject fixed=codec.modCodec.findRecipe(save,ids);if(fixed!=null){JSONObject result=SaveCodec.obj(fixed.opt("result"));store.putPending(SaveCodec.record("saveId",save.opt("id"),"operationId",op,"ingredientIds",SaveCodec.parseArray(key),"result",result,"now",SaveCodec.now(),"source",fixed.opt("source"),"modStates",new JSONArray(),"modProcessed",false));return result;}
        JSONObject secret=vault.read();Fault.require(secret!=null,"KEY_REQUIRED");JSONArray themes=new JSONArray(),mods=SaveCodec.arr(save.opt("mods"),16);for(int i=0;i<mods.length();i++){JSONObject mod=SaveCodec.obj(mods.opt(i));String theme=SaveCodec.str(SaveCodec.obj(mod.opt("manifest")).opt("theme"));if(Boolean.TRUE.equals(mod.opt("enabled"))&&!theme.isEmpty())themes.put(theme);}
        // 本次请求读取当前档已保存的创作提示；连接检测继续走默认提示且不写卡牌。
        JSONObject result=ai.generate(SaveCodec.obj(secret.opt("config")),SaveCodec.str(secret.opt("key")),materials,themes,codec.synthesisPrompt(SaveCodec.obj(save.opt("preferences")).opt("synthesisPrompt")),request);request.check();
        JSONObject record=SaveCodec.record("saveId",save.opt("id"),"operationId",op,"ingredientIds",SaveCodec.parseArray(key),"result",result,"now",SaveCodec.now(),"source",SaveCodec.record("kind","ai"),"modStates",new JSONArray(),"modProcessed",false);
        // 从成功响应到落盘构成一个提交边界；取消不能清除已经收到的有效答案。
        synchronized(requestLock){request.check();library.assertActive(args.opt("slotId"));store.putPending(record);}return result;
    }
    private JSONObject stageMod(JSONObject args,SlotStorage store,boolean update){
        JSONObject save=store.load();Fault.require(save!=null,"INVALID_SAVE");String operation=SaveCodec.id(args.opt("operationId"));Fault.require(operation.length()<=128,"INVALID_ID");JSONObject pending=store.loadPending();
        JSONArray ids=update?(pending==null?null:SaveCodec.arr(pending.opt("ingredientIds"),4)):SaveCodec.arr(args.opt("ingredientIds"),4);Fault.require(ids!=null,"OPERATION_CONFLICT");String key=SaveCodec.recipeKey(ids);if(update)Fault.require(operation.equals(pending.opt("operationId")),"OPERATION_CONFLICT");
        Map<String,JSONObject> cards=SaveCodec.indexed(SaveCodec.arr(save.opt("cards"),25000),"id");for(int i=0;i<ids.length();i++)Fault.require(cards.containsKey(ids.opt(i)),"UNKNOWN_INGREDIENT");JSONArray mods=SaveCodec.arr(save.opt("mods"),16);JSONObject result=codec.card(args.opt("result")),source=codec.modCodec.source(args.opt("source"),mods);JSONArray states=codec.modCodec.states(args.opt("modStates"),mods);
        if(!update)Fault.require("mod".equals(source.opt("kind"))||"recipe".equals(source.opt("kind")),"INVALID_SOURCE");
        JSONObject known=SaveCodec.indexed(SaveCodec.arr(save.opt("recipes"),100000),"key").get(key);if(known!=null)Fault.require(SaveCodec.same(result,codec.card(cards.get(known.opt("resultId"))))&&"recipe".equals(source.opt("kind")),"OPERATION_CONFLICT");else Fault.require(!"recipe".equals(source.opt("kind")),"INVALID_SOURCE");
        JSONObject record=SaveCodec.record("saveId",save.opt("id"),"operationId",operation,"ingredientIds",SaveCodec.parseArray(key),"result",result,"now",update?pending.opt("now"):SaveCodec.now(),"source",source,"modStates",states,"modProcessed",true);
        if(update)store.updatePending(record,operation);else if(pending!=null){Fault.require(operation.equals(pending.opt("operationId"))&&key.equals(SaveCodec.recipeKey(pending.opt("ingredientIds")))&&SaveCodec.same(result,pending.opt("result"))&&SaveCodec.same(source,pending.opt("source"))&&SaveCodec.same(states,pending.opt("modStates")),"OPERATION_CONFLICT");return pending;}else store.putPending(record);return record;
    }
    private void showFile(Object id,int code,byte[] data){runOnUiThread(()->{
        if(dialogActive){respond(id,null,"BUSY");return;}dialogActive=true;fileRequestId=id;exportBytes=data;
        Intent intent=new Intent(code==EXPORT?Intent.ACTION_CREATE_DOCUMENT:Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(code==EXPORT?"application/json":"*/*");if(code==EXPORT)intent.putExtra(Intent.EXTRA_TITLE,"无限工厂3-"+java.time.LocalDate.now()+".json");
        try{startActivityForResult(intent,code);}catch(Exception e){dialogActive=false;fileRequestId=null;exportBytes=null;respond(id,null,code==EXPORT?"FILE_WRITE_FAILED":"FILE_READ_FAILED");}
    });}
    @Override protected void onActivityResult(int code,int result,Intent intent){super.onActivityResult(code,result,intent);if(code!=EXPORT&&code!=IMPORT&&code!=MOD_IMPORT)return;Object id=fileRequestId;byte[] bytes=exportBytes;fileRequestId=null;exportBytes=null;dialogActive=false;if(id==null)return;
        if(result!=RESULT_OK||intent==null||intent.getData()==null){respond(id,code==EXPORT?false:null,null);return;}Uri uri=intent.getData();if(!"content".equals(uri.getScheme())){respond(id,null,code==EXPORT?"FILE_WRITE_FAILED":"FILE_READ_FAILED");return;}
        work.execute(()->{try{
            if(code==IMPORT||code==MOD_IMPORT){byte[] input;try(InputStream in=getContentResolver().openInputStream(uri)){Fault.require(in!=null,"FILE_READ_FAILED");input=PrivateFiles.read(in,code==MOD_IMPORT?ModCodec.MAX_PACKAGE:SaveCodec.MAX_BYTES,code==MOD_IMPORT?"MOD_TOO_LARGE":"SAVE_TOO_LARGE");}String text=new String(input,StandardCharsets.UTF_8);JSONObject clean=code==MOD_IMPORT?codec.modCodec.validatePackage(text):codec.validate(SaveCodec.parse(text));respond(id,clean.toString(),null);}
            else{
                // ACTION_CREATE_DOCUMENT通常新建文件，但仍拒绝任何非空目标；绝不以wt先截断再检查。
                try(InputStream in=getContentResolver().openInputStream(uri)){Fault.require(in!=null,"FILE_READ_FAILED");Fault.require(in.read()==-1,"EXPORT_FILE_EXISTS");}
                try(ParcelFileDescriptor descriptor=getContentResolver().openFileDescriptor(uri,"rw")){Fault.require(descriptor!=null,"FILE_WRITE_FAILED");long size=descriptor.getStatSize();Fault.require(size<=0,"EXPORT_FILE_EXISTS");try(ParcelFileDescriptor.AutoCloseOutputStream out=new ParcelFileDescriptor.AutoCloseOutputStream(descriptor)){out.write(bytes);out.flush();out.getFD().sync();}}
                byte[] actual;try(InputStream in=getContentResolver().openInputStream(uri)){Fault.require(in!=null,"FILE_READ_FAILED");actual=PrivateFiles.read(in,SaveCodec.MAX_BYTES,"SAVE_TOO_LARGE");}Fault.require(Arrays.equals(bytes,actual),"FILE_WRITE_FAILED");respond(id,true,null);
            }
        }catch(Fault e){respond(id,null,e.code);}catch(Exception e){respond(id,null,code==EXPORT?"FILE_WRITE_FAILED":"FILE_READ_FAILED");}});
    }
    @Override public void onBackPressed(){if(web!=null)web.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));",null);}
    @Override protected void onDestroy(){destroyed=true;synchronized(requestLock){if(activeRequest!=null)activeRequest.cancel();}if(web!=null){web.removeJavascriptInterface("wxgcAndroid");web.destroy();web=null;}work.execute(()->{if(library!=null)library.close();if(ai!=null)ai.close();});work.shutdown();super.onDestroy();}
}
