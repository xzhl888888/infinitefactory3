package com.geometryworkshop.wxgc3.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** 独立测试 APK 反射调用目标 APK 的真实存储类，只在目标应用的随机 cache 子目录写测试数据。 */
public final class StorageDeviceTests extends Instrumentation {
    private Class<?> storeType;
    private Constructor<?> storeConstructor;
    private Object codec;
    private int checks;

    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments);start(); }

    private void check(boolean condition, String label) {
        checks++;
        if (!condition) throw new AssertionError(label);
    }

    private byte[] read(InputStream input) throws IOException {
        try (InputStream stream=input;ByteArrayOutputStream result=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[8192];int size;
            while ((size=stream.read(buffer))!=-1) result.write(buffer,0,size);
            return result.toByteArray();
        }
    }

    private String text(File file) throws IOException { return new String(read(new FileInputStream(file)),StandardCharsets.UTF_8); }
    private void write(File file, String value) throws IOException {
        try (FileOutputStream stream=new FileOutputStream(file)) { stream.write(value.getBytes(StandardCharsets.UTF_8)); }
    }
    private Object open(File directory, boolean mustExist) throws Exception { return storeConstructor.newInstance(directory,codec,mustExist); }
    private Object call(Object store, String name, Class<?>[] types, Object... arguments) throws Exception {
        Method method=storeType.getDeclaredMethod(name,types);method.setAccessible(true);
        return method.invoke(store,arguments);
    }
    private Object call(Object store, String name) throws Exception { return call(store,name,new Class<?>[0]); }
    private JSONObject pending(Object store, String id) throws Exception { return (JSONObject)call(store,"loadPending",new Class<?>[]{String.class},id); }
    private JSONArray pending(Object store) throws Exception { return (JSONArray)call(store,"listPending"); }
    private void put(Object store, JSONObject value) throws Exception { call(store,"putPending",new Class<?>[]{JSONObject.class},value); }
    private void close(Object store) throws Exception { call(store,"close"); }
    private void save(Object store, JSONObject value, long expected) throws Exception { call(store,"save",new Class<?>[]{JSONObject.class,long.class},value,expected); }
    private boolean available(Object store) throws Exception { return ((JSONObject)call(store,"status")).getBoolean("storageAvailable"); }
    private String error(Object store) throws Exception { return ((JSONObject)call(store,"status")).getString("error"); }
    private int version(File directory) {
        SQLiteDatabase database=SQLiteDatabase.openDatabase(new File(directory,"game.sqlite").getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY);
        try { return database.getVersion(); } finally { database.close(); }
    }
    private void legacy(File directory, String save, String pending) {
        if (!directory.mkdirs()) throw new AssertionError("legacy test directory");
        SQLiteDatabase database=SQLiteDatabase.openOrCreateDatabase(new File(directory,"game.sqlite"),null);
        try {
            database.execSQL("CREATE TABLE current_save (singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,document TEXT NOT NULL)");
            database.execSQL("CREATE TABLE pending_result (singleton INTEGER PRIMARY KEY CHECK(singleton=1),document TEXT NOT NULL)");
            database.execSQL("INSERT INTO current_save VALUES(1,0,?)",new Object[]{save});
            database.execSQL("INSERT INTO pending_result VALUES(1,?)",new Object[]{pending});
            database.setVersion(1);
        } finally { database.close(); }
    }

    @Override public void onStart() {
        Bundle result=new Bundle();
        try {
            JSONObject fixture=new JSONObject(new String(read(getContext().getAssets().open("storage-fixtures.json")),StandardCharsets.UTF_8));
            JSONObject cases=fixture.getJSONObject("deviceCases");
            ClassLoader loader=getTargetContext().getClassLoader();
            Class<?> codecType=Class.forName("com.geometryworkshop.wxgc3.SaveCodec",true,loader);
            Constructor<?> codecConstructor=codecType.getDeclaredConstructor(JSONObject.class);codecConstructor.setAccessible(true);
            JSONObject catalog=new JSONObject(new String(read(getTargetContext().getAssets().open("native-catalog.json")),StandardCharsets.UTF_8));
            codec=codecConstructor.newInstance(catalog);
            storeType=Class.forName("com.geometryworkshop.wxgc3.GameStore",true,loader);
            storeConstructor=storeType.getDeclaredConstructor(File.class,codecType,boolean.class);storeConstructor.setAccessible(true);
            File root=new File(getTargetContext().getCacheDir(),"storage-parallel-tests-"+UUID.randomUUID());
            check(root.mkdirs(),"isolated directory");

            File freshDirectory=new File(root,"fresh");Object store=open(freshDirectory,false);
            check(available(store)&&version(freshDirectory)==2,"fresh schema2");
            call(store,"initialize",new Class<?>[]{JSONObject.class},cases.getJSONObject("fresh"));
            JSONObject first=cases.getJSONObject("firstPending"),second=cases.getJSONObject("secondPending");
            String firstId=first.getString("operationId"),secondId=second.getString("operationId");
            put(store,first);put(store,second);put(store,first);
            check(pending(store).length()==2,"two answers and idempotent put");
            check(firstId.equals(((JSONObject)call(store,"loadPending")).getString("operationId")),"legacy API returns oldest");
            close(store);store=open(freshDirectory,true);
            check(available(store)&&pending(store).length()==2,"both answers survive reopen");
            check(firstId.equals(pending(store,firstId).getString("operationId")),"load a named answer");
            check(pending(store,"unknown-operation")==null,"unknown ID leaves storage available");
            JSONObject changed=new JSONObject(first.toString());changed.put("modProcessed",false);
            call(store,"updatePending",new Class<?>[]{JSONObject.class,String.class},changed,firstId);
            check(!pending(store,firstId).getBoolean("modProcessed")&&pending(store,secondId).getBoolean("modProcessed"),"update only selected answer");
            call(store,"updatePending",new Class<?>[]{JSONObject.class,String.class},first,firstId);
            boolean rejected=false;
            try { save(store,cases.getJSONObject("afterSecond"),99); }
            catch (InvocationTargetException expected) { rejected="REVISION_CONFLICT".equals(expected.getCause().getMessage()); }
            check(rejected&&pending(store).length()==2,"failed commit preserves both answers");
            save(store,cases.getJSONObject("afterSecond"),0);
            check(pending(store).length()==1&&pending(store,secondId)==null&&pending(store,firstId)!=null,"commit removes only its answer");
            save(store,cases.getJSONObject("afterSecond"),0);
            check(pending(store).length()==1&&pending(store,firstId)!=null,"lost response retry keeps the other answer");
            save(store,cases.getJSONObject("afterBoth"),1);
            check(pending(store).length()==0,"both committed");
            JSONObject complete=(JSONObject)call(store,"load");
            check(complete.getJSONArray("cards").length()==7&&complete.getJSONArray("recipes").length()==2&&complete.getJSONObject("stats").getInt("synthesisCount")==2,"reverse completion retains discoveries and stats");
            close(store);

            String originalSave=" \n"+cases.getJSONObject("fresh").toString()+"\n";
            String originalPending="\n"+first.toString()+"  ";
            File oldDirectory=new File(root,"legacy");legacy(oldDirectory,originalSave,originalPending);
            store=open(oldDirectory,true);
            check(available(store)&&version(oldDirectory)==2&&pending(store).length()==1,"schema1 migration keeps pending");
            check(originalSave.equals(text(new File(oldDirectory,"database-v1-save-original.json"))),"exact original save preserved");
            check(originalPending.equals(text(new File(oldDirectory,"database-v1-pending-original.json"))),"exact original answer preserved");
            close(store);store=open(oldDirectory,true);
            check(available(store)&&pending(store,firstId)!=null,"migrated answer survives reopen");close(store);

            File failedDirectory=new File(root,"blocked-migration");legacy(failedDirectory,originalSave,originalPending);
            File protectedCopy=new File(failedDirectory,"database-v1-save-original.json");write(protectedCopy,"preserve this existing file");
            store=open(failedDirectory,true);
            check(!available(store)&&"MIGRATION_BACKUP_FAILED".equals(error(store)),"backup failure blocks migration");close(store);
            check(version(failedDirectory)==1&&"preserve this existing file".equals(text(protectedCopy)),"failed migration leaves original schema and backup");
            SQLiteDatabase unchanged=SQLiteDatabase.openDatabase(new File(failedDirectory,"game.sqlite").getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY);
            try (Cursor cursor=unchanged.rawQuery("SELECT document FROM pending_result WHERE singleton=1",null)) {
                check(cursor.moveToFirst()&&originalPending.equals(cursor.getString(0)),"failed migration leaves exact pending document");
            } finally { unchanged.close(); }
            result.putString("storageParallelRegression","PASS");result.putInt("checks",checks);
            finish(Activity.RESULT_OK,result);
        } catch (Throwable failure) {
            Throwable cause=failure instanceof InvocationTargetException ? failure.getCause() : failure;
            result.putString("storageParallelRegression","FAIL");result.putString("error",cause.toString());result.putInt("checks",checks);
            finish(Activity.RESULT_CANCELED,result);
        }
    }
}
