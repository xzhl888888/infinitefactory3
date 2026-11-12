package com.geometryworkshop.wxgc3;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** 注册表只管理稳定档位身份；槽内快照、pending和备份从不跨目录共享。 */
final class GameLibrary {
    interface StoreFactory { SlotStorage open(File directory,boolean mustExist); }
    interface RegistryIO { boolean exists(File file); byte[] read(File file); void write(File file,byte[] bytes); }
    private static final int REGISTRY_MAX=128*1024, SLOT_LIMIT=100;
    private static final Object REGISTRY_LOCK=new Object();
    private final File root,registryFile;
    private final StoreFactory factory;
    private final RegistryIO io;
    private final SaveCodec codec;
    private final Map<String,SlotStorage> opened=new HashMap<>();
    private JSONObject registry;
    private byte[] expectedRegistryBytes;
    private String failure;

    GameLibrary(File root,SaveCodec codec){this(root,codec,(directory,mustExist)->new GameStore(directory,codec,mustExist),new RegistryIO(){
        public boolean exists(File file){return file.exists()||new File(file.getPath()+".bak").exists();}
        public byte[] read(File file){return PrivateFiles.readAtomic(file,REGISTRY_MAX,"LIBRARY_CORRUPT");}
        public void write(File file,byte[] bytes){PrivateFiles.writeAtomic(file,bytes,"LIBRARY_WRITE_FAILED");}
    });}
    GameLibrary(File root,SaveCodec codec,StoreFactory factory,RegistryIO io){
        this.root=root;this.codec=codec;this.factory=factory;this.io=io;registryFile=new File(root,"library.json");
        try{
            if(io.exists(registryFile)){expectedRegistryBytes=io.read(registryFile);registry=validateRegistry(SaveCodec.parse(new String(expectedRegistryBytes,StandardCharsets.UTF_8),REGISTRY_MAX));return;}
            File legacy=new File(root,"game"),slotsRoot=new File(root,"slots");String[] existing=slotsRoot.list();
            // 注册表丢失却仍有新档目录时不推定为首次启动，避免把已有存档隐藏成一个新空档。
            Fault.require(existing==null||existing.length==0,"LIBRARY_CORRUPT");
            boolean old=legacy.exists();String id="legacy",name=old?"原有存档":"我的世界";
            SlotStorage storage=factory.open(directory(id),old);opened.put(id,storage);
            JSONObject first=SaveCodec.record("formatVersion",1,"activeSlotId",id,"slots",new JSONArray().put(SaveCodec.record("id",id,"name",name)));
            persist(first);
        }catch(Exception e){failure=e instanceof Fault&&"LIBRARY_WRITE_FAILED".equals(((Fault)e).code)?"LIBRARY_WRITE_FAILED":"LIBRARY_CORRUPT";registry=null;}
    }
    static String slotId(Object raw){Fault.require(raw instanceof String,"SLOT_NOT_FOUND");String id=(String)raw;Fault.require("legacy".equals(id)||id.matches("slot-[a-f0-9]{32}"),"SLOT_NOT_FOUND");return id;}
    static String name(Object raw){String rawName=SaveCodec.str(raw),name=rawName.replaceAll("^"+SaveCodec.WS+"|"+SaveCodec.WS+"$","");Fault.require(!name.isEmpty()&&rawName.codePointCount(0,rawName.length())<=40&&!rawName.matches("(?s).*"+SaveCodec.CONTROLS+".*"),"INVALID_SLOT_NAME");return name;}
    static JSONObject validateRegistry(JSONObject raw){
        Fault.require(Integer.valueOf(1).equals(raw.opt("formatVersion")),"LIBRARY_CORRUPT");String active=slotId(raw.opt("activeSlotId"));JSONArray source=SaveCodec.arr(raw.opt("slots"),SLOT_LIMIT),slots=new JSONArray();Set<String> ids=new HashSet<>();
        Fault.require(source.length()>0,"LIBRARY_CORRUPT");for(int i=0;i<source.length();i++){JSONObject slot=SaveCodec.obj(source.opt(i));String id=slotId(slot.opt("id"));Fault.require(ids.add(id),"LIBRARY_CORRUPT");slots.put(SaveCodec.record("id",id,"name",name(slot.opt("name"))));}Fault.require(ids.contains(active),"LIBRARY_CORRUPT");return SaveCodec.record("formatVersion",1,"activeSlotId",active,"slots",slots);
    }
    private void ready(){Fault.require(registry!=null&&failure==null,failure==null?"LIBRARY_CORRUPT":failure);}
    private File directory(String id){return "legacy".equals(id)?new File(root,"game"):new File(new File(root,"slots"),id);}
    private String newSlotId(){return "slot-"+UUID.randomUUID().toString().replace("-","");}
    private void persist(JSONObject proposed){JSONObject clean=validateRegistry(proposed);byte[] bytes=clean.toString().getBytes(StandardCharsets.UTF_8);Fault.require(bytes.length<=REGISTRY_MAX,"LIBRARY_CORRUPT");synchronized(REGISTRY_LOCK){boolean exists=io.exists(registryFile);Fault.require(expectedRegistryBytes==null?!exists:exists&&Arrays.equals(expectedRegistryBytes,io.read(registryFile)),"LIBRARY_CHANGED");io.write(registryFile,bytes);expectedRegistryBytes=bytes.clone();registry=clean;failure=null;}}
    private JSONObject entry(String id){ready();JSONArray slots=SaveCodec.arr(registry.opt("slots"),SLOT_LIMIT);for(int i=0;i<slots.length();i++){JSONObject slot=SaveCodec.obj(slots.opt(i));if(id.equals(slot.opt("id")))return slot;}throw new Fault("SLOT_NOT_FOUND");}
    private SlotStorage storage(String id){entry(id);SlotStorage store=opened.get(id);if(store==null){store=factory.open(directory(id),true);opened.put(id,store);}return store;}
    synchronized String activeId(){ready();return SaveCodec.str(registry.opt("activeSlotId"));}
    synchronized void assertActive(Object expected){ready();Fault.require(expected instanceof String&&activeId().equals(expected),"SLOT_CHANGED");}
    synchronized SlotStorage active(Object expected){assertActive(expected);return storage(activeId());}
    synchronized JSONObject withName(Object expected,JSONObject save){assertActive(expected);if(save==null)return null;JSONObject copy=SaveCodec.parse(save.toString());SaveCodec.put(copy,"name",entry(activeId()).opt("name"));return copy;}
    synchronized JSONObject load(Object expected){return withName(expected,active(expected).load());}
    synchronized JSONObject recoveryStatus(Object expected){if(failure!=null)return SaveCodec.record("storageAvailable",false,"error",failure,"backupWarning",null);return active(expected).status();}
    private void mayLeave(){
        SlotStorage store=storage(activeId());if(!Boolean.TRUE.equals(store.status().opt("storageAvailable")))return;
        try{Fault.require(store.loadPending()==null,"PENDING_SAVE_REQUIRED");}catch(Fault e){if("PENDING_SAVE_REQUIRED".equals(e.code))throw e;Fault.require(!Boolean.TRUE.equals(store.status().opt("storageAvailable")),e.code);}
    }
    synchronized JSONObject status(){
        ready();JSONArray slots=SaveCodec.arr(registry.opt("slots"),SLOT_LIMIT),summary=new JSONArray();
        for(int i=0;i<slots.length();i++){
            JSONObject slot=SaveCodec.obj(slots.opt(i)),save=null;boolean available=false;try{SlotStorage store=storage(SaveCodec.str(slot.opt("id")));if(Boolean.TRUE.equals(store.status().opt("storageAvailable"))){save=store.load();available=true;}}catch(Fault ignored){}
            int cards=save==null?0:SaveCodec.arr(save.opt("cards"),25000).length(),recipes=save==null?0:SaveCodec.arr(save.opt("recipes"),100000).length();long count=save==null?0:SaveCodec.integer(SaveCodec.obj(save.opt("stats")).opt("synthesisCount"));int mods=save!=null&&save.opt("mods") instanceof JSONArray?((JSONArray)save.opt("mods")).length():0;
            summary.put(SaveCodec.record("id",slot.opt("id"),"name",slot.opt("name"),"saveId",save==null?null:save.opt("id"),"cardCount",cards,"recipeCount",recipes,"synthesisCount",count,"updatedAt",save==null?null:save.opt("updatedAt"),"modCount",mods,"available",available));
        }
        return SaveCodec.record("activeSlotId",activeId(),"slots",summary);
    }
    private JSONObject result(){JSONObject save=null;try{save=load(activeId());}catch(Fault ignored){}return SaveCodec.record("save",save,"library",status());}
    synchronized JSONObject switchSlot(Object id){ready();String target=slotId(id);entry(target);mayLeave();JSONObject next=SaveCodec.parse(registry.toString());SaveCodec.put(next,"activeSlotId",target);persist(next);return result();}
    synchronized JSONObject renameSlot(Object id,Object rawName){ready();String target=slotId(id),name=name(rawName);entry(target);mayLeave();JSONObject next=SaveCodec.parse(registry.toString());JSONArray slots=SaveCodec.arr(next.opt("slots"),SLOT_LIMIT);for(int i=0;i<slots.length();i++){JSONObject slot=SaveCodec.obj(slots.opt(i));if(target.equals(slot.opt("id")))SaveCodec.put(slot,"name",name);}persist(next);return result();}
    synchronized JSONObject createSlot(Object rawName,JSONObject raw,boolean imported){
        ready();mayLeave();String name=name(rawName);JSONArray slots=SaveCodec.arr(registry.opt("slots"),SLOT_LIMIT);Fault.require(slots.length()<SLOT_LIMIT,"SLOT_LIMIT");JSONObject save=imported?codec.validate(raw):codec.initial(raw);String id=newSlotId();
        // 新槽必须拥有独立存档身份；导入同一文件两次也不能混用pending或后续提交。
        SaveCodec.put(save,"id",UUID.randomUUID().toString());SaveCodec.put(save,"revision",0);SaveCodec.put(save,"name",name);
        SlotStorage store=factory.open(directory(id),false);try{if(imported)store.importSave(save);else store.initialize(save);JSONObject next=SaveCodec.parse(registry.toString());SaveCodec.arr(next.opt("slots"),SLOT_LIMIT).put(SaveCodec.record("id",id,"name",name));SaveCodec.put(next,"activeSlotId",id);persist(next);opened.put(id,store);return result();}catch(Exception e){store.close();throw e;}
    }
    synchronized void close(){for(SlotStorage store:opened.values())store.close();opened.clear();}
}
