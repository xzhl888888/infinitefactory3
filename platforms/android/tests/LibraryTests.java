package com.geometryworkshop.wxgc3;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** 执行真实GameLibrary逻辑，注入故障IO和隔离槽存储；不冒充Android SQLite/Keystore真机检查。 */
public final class LibraryTests {
    static final class MemoryIO implements GameLibrary.RegistryIO {
        final Map<String,byte[]> files=new HashMap<>();boolean failNext;
        public boolean exists(File file){return files.containsKey(file.getAbsolutePath());}
        public byte[] read(File file){byte[] bytes=files.get(file.getAbsolutePath());if(bytes==null)throw new Fault("LIBRARY_CORRUPT");return bytes.clone();}
        public void write(File file,byte[] bytes){if(failNext){failNext=false;throw new Fault("LIBRARY_WRITE_FAILED");}files.put(file.getAbsolutePath(),bytes.clone());}
    }
    static final class FakeStore implements SlotStorage {
        final SaveCodec codec;JSONObject raw,pending;boolean bad;
        FakeStore(SaveCodec codec){this.codec=codec;}
        public JSONObject status(){return SaveCodec.record("storageAvailable",!bad,"error",bad?"STORAGE_CORRUPT":null,"backupWarning",null);}
        public JSONObject load(){Fault.require(!bad,"STORAGE_CORRUPT");return raw==null?null:codec.validate(raw);}
        public JSONObject initialize(JSONObject save){Fault.require(raw==null,"REVISION_CONFLICT");raw=codec.initial(save);return load();}
        public JSONObject save(JSONObject save,long expected){Fault.require(load()!=null&&SaveCodec.integer(raw.opt("revision"))==expected,"REVISION_CONFLICT");raw=codec.validate(save);return load();}
        public JSONObject importSave(JSONObject save){Fault.require(!bad,"STORAGE_CORRUPT");raw=codec.validate(save);return load();}
        public JSONObject loadPending(){Fault.require(!bad,"STORAGE_CORRUPT");return pending;}
        public void putPending(JSONObject value){Fault.require(pending==null,"BUSY");pending=value;}
        public void updatePending(JSONObject value,String id){Fault.require(pending!=null&&id.equals(pending.opt("operationId")),"OPERATION_CONFLICT");pending=value;}
        public JSONArray listBackups(){return new JSONArray();}
        public JSONObject restore(String id){return load();}
        public JSONObject recover(JSONObject save){bad=false;raw=codec.validate(save);return load();}
        public void close(){}
    }
    static final class Factory implements GameLibrary.StoreFactory {
        final SaveCodec codec;final Map<String,FakeStore> stores=new HashMap<>();
        Factory(SaveCodec codec){this.codec=codec;}
        public SlotStorage open(File directory,boolean mustExist){String id=directory.getAbsolutePath();FakeStore store=stores.get(id);if(store!=null)return store;store=new FakeStore(codec);store.bad=mustExist;if(!mustExist)directory.mkdirs();stores.put(id,store);return store;}
    }
    static JSONObject clone(JSONObject v){return SaveCodec.parse(v.toString());}
    public static void main(String[] args)throws Exception{
        Path evidence=Paths.get(args[0]);JSONObject fixture=SaveCodec.parse(new String(Files.readAllBytes(evidence.resolve("fixture.json")),StandardCharsets.UTF_8));SaveCodec codec=new SaveCodec(SaveCodec.obj(fixture.opt("catalog")));JSONObject fresh=SaveCodec.obj(SaveCodec.obj(SaveCodec.arr(fixture.opt("cases"),100).opt(0)).opt("save"));
        File root=evidence.resolve("library-new").toFile();MemoryIO io=new MemoryIO();Factory factory=new Factory(codec);GameLibrary library=new GameLibrary(root,codec,factory,io);
        ContractTests.check("legacy".equals(library.activeId()));ContractTests.check(SaveCodec.arr(library.status().opt("slots"),100).length()==1);ContractTests.check(library.load("legacy")==null);
        library.active("legacy").initialize(clone(fresh));ContractTests.check("我的世界".equals(library.load("legacy").opt("name")));
        JSONObject second=library.createSlot("第二世界",clone(fresh),false);String secondId=library.activeId();ContractTests.check(!"legacy".equals(secondId)&&secondId.startsWith("slot-"));ContractTests.check(!fresh.opt("id").equals(SaveCodec.obj(second.opt("save")).opt("id")));ContractTests.check(SaveCodec.arr(library.status().opt("slots"),100).length()==2);
        ContractTests.error("SLOT_CHANGED",()->library.active("legacy"));ContractTests.error("SLOT_CHANGED",()->library.active(null));ContractTests.error("SLOT_NOT_FOUND",()->library.switchSlot("../game"));
        FakeStore current=(FakeStore)library.active(secondId);current.pending=SaveCodec.record("operationId","waiting");ContractTests.error("PENDING_SAVE_REQUIRED",()->library.switchSlot("legacy"));ContractTests.error("PENDING_SAVE_REQUIRED",()->library.renameSlot(secondId,"失败改名"));ContractTests.error("PENDING_SAVE_REQUIRED",()->library.createSlot("失败新建",fresh,false));ContractTests.check(secondId.equals(library.activeId()));current.pending=null;
        String storedName=SaveCodec.str(current.raw.opt("name"));library.renameSlot(secondId,"重新命名");ContractTests.check("重新命名".equals(library.load(secondId).opt("name")));ContractTests.check(storedName.equals(current.raw.opt("name")));ContractTests.error("INVALID_SLOT_NAME",()->library.renameSlot(secondId,"坏\n名字"));
        library.switchSlot("legacy");ContractTests.check(library.active("legacy").loadPending()==null);ContractTests.check(fresh.opt("id").equals(library.load("legacy").opt("id")));ContractTests.error("SLOT_CHANGED",()->library.active(secondId));
        byte[] before=io.read(new File(root,"library.json"));io.failNext=true;ContractTests.error("LIBRARY_WRITE_FAILED",()->library.renameSlot("legacy","不该保存"));ContractTests.check(Arrays.equals(before,io.read(new File(root,"library.json"))));ContractTests.check("我的世界".equals(library.load("legacy").opt("name")));
        int count=SaveCodec.arr(library.status().opt("slots"),100).length();io.failNext=true;ContractTests.error("LIBRARY_WRITE_FAILED",()->library.createSlot("登记失败",fresh,true));ContractTests.check(SaveCodec.arr(library.status().opt("slots"),100).length()==count&&"legacy".equals(library.activeId()));
        GameLibrary stale=new GameLibrary(root,codec,factory,io);library.renameSlot("legacy","主世界");ContractTests.error("LIBRARY_CHANGED",()->stale.renameSlot("legacy","迟到窗口"));ContractTests.check("主世界".equals(library.load("legacy").opt("name")));
        JSONObject imported=library.createSlot("分享副本",fresh,true);String importedId=library.activeId();ContractTests.check(!fresh.opt("id").equals(SaveCodec.obj(imported.opt("save")).opt("id")));ContractTests.check(!secondId.equals(importedId));ContractTests.check("分享副本".equals(library.load(importedId).opt("name")));
        FakeStore legacy=(FakeStore)factory.stores.get(new File(root,"game").getAbsolutePath());legacy.bad=true;library.switchSlot("legacy");ContractTests.check(!Boolean.TRUE.equals(SaveCodec.obj(SaveCodec.arr(library.status().opt("slots"),100).opt(0)).opt("available")));ContractTests.error("STORAGE_CORRUPT",()->library.load("legacy"));library.switchSlot(importedId);ContractTests.check(library.load(importedId)!=null&&legacy.bad);
        byte[] corrupt="{broken".getBytes(StandardCharsets.UTF_8);io.files.put(new File(root,"library.json").getAbsolutePath(),corrupt);GameLibrary broken=new GameLibrary(root,codec,factory,io);ContractTests.error("LIBRARY_CORRUPT",()->broken.status());ContractTests.error("LIBRARY_CORRUPT",()->broken.createSlot("新建",fresh,false));ContractTests.check(Arrays.equals(corrupt,io.read(new File(root,"library.json"))));
        io.files.remove(new File(root,"library.json").getAbsolutePath());GameLibrary missing=new GameLibrary(root,codec,factory,io);ContractTests.error("LIBRARY_CORRUPT",()->missing.status());ContractTests.check(!io.exists(new File(root,"library.json")));
        File oldRoot=evidence.resolve("library-upgrade").toFile(),oldDirectory=new File(oldRoot,"game");oldDirectory.mkdirs();Factory oldFactory=new Factory(codec);FakeStore oldStore=new FakeStore(codec);oldStore.raw=clone(fresh);SaveCodec.put(oldStore.raw,"formatVersion",1);oldStore.raw.remove("name");oldStore.raw.remove("mods");oldFactory.stores.put(oldDirectory.getAbsolutePath(),oldStore);MemoryIO oldIO=new MemoryIO();GameLibrary upgrade=new GameLibrary(oldRoot,codec,oldFactory,oldIO);ContractTests.check("legacy".equals(upgrade.activeId()));ContractTests.check(SaveCodec.arr(upgrade.load("legacy").opt("cards"),25000).length()==5);ContractTests.check(Integer.valueOf(1).equals(oldStore.raw.opt("formatVersion")));ContractTests.check(oldDirectory.exists()&&!new File(oldRoot,"slots").exists());
        JSONObject result=SaveCodec.record("passed",ContractTests.checks,"scope","real registry logic with injected atomic IO and slot stores; Android SQLite/Keystore not exercised","slotIsolation",true,"corruptRegistryPreserved",true,"legacyDirectoryPreserved",true);Files.write(evidence.resolve("library-results.json"),result.toString().getBytes(StandardCharsets.UTF_8));System.out.println(result.toString());
    }
}
