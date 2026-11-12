package com.geometryworkshop.wxgc3;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** 一个SQLite快照是事实来源；外部5槽原子副本用于主库损坏时恢复，不自动覆盖坏库。 */
final class GameStore implements SlotStorage {
    final SaveCodec codec;
    private final File directory, pointer;
    private SQLiteDatabase db;
    private String failure,backupWarning;
    GameStore(File slotDirectory,SaveCodec codec,boolean mustExist) {
        this.codec=codec;directory=slotDirectory;pointer=new File(directory,"active-db");
        if(mustExist&&!directory.isDirectory()){failure="STORAGE_CORRUPT";return;}
        if(!directory.isDirectory()&&!directory.mkdirs()){failure="STORAGE_ERROR";return;}
        try {
            String file=pointer.exists()?new String(PrivateFiles.readAtomic(pointer,200,"STORAGE_CORRUPT"),StandardCharsets.UTF_8):"game.sqlite";
            Fault.require(file.matches("game(?:-recovery-[A-Za-z0-9-]+)?\\.sqlite"),"STORAGE_CORRUPT");
            File activeFile=new File(directory,file);boolean hadProgress=pointer.exists();for(int i=0;i<5;i++)if(new File(directory,"slot-"+i+".json").exists())hadProgress=true;
            Fault.require(!mustExist||activeFile.isFile(),"STORAGE_CORRUPT");
            Fault.require(!(activeFile.exists()&&activeFile.length()==0)&&(!hadProgress||activeFile.isFile()),"STORAGE_CORRUPT");
            db=open(file);Fault.require(!hadProgress||load()!=null,"STORAGE_CORRUPT");load();
        }catch(Exception e){failure="STORAGE_CORRUPT";if(db!=null){db.close();db=null;}}
    }
    private SQLiteDatabase open(String name) {
        // 默认Android损坏回调会删除数据库；这里明确保留坏库和日志，交给玩家选择恢复。
        SQLiteDatabase opened=SQLiteDatabase.openDatabase(new File(directory,name).getAbsolutePath(),null,SQLiteDatabase.OPEN_READWRITE|SQLiteDatabase.CREATE_IF_NECESSARY,corrupt -> {});
        try {
            opened.execSQL("PRAGMA synchronous=FULL");opened.enableWriteAheadLogging();
            if(opened.getVersion()==0){
                try(Cursor cursor=opened.rawQuery("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",null)){cursor.moveToFirst();Fault.require(cursor.getInt(0)==0,"STORAGE_CORRUPT");}
                opened.beginTransaction();try{opened.execSQL("CREATE TABLE current_save (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, document TEXT NOT NULL)");opened.execSQL("CREATE TABLE pending_result (singleton INTEGER PRIMARY KEY CHECK(singleton=1), document TEXT NOT NULL)");opened.setVersion(1);opened.setTransactionSuccessful();}finally{opened.endTransaction();}
            }
            Fault.require(opened.getVersion()==1,"UNSUPPORTED_SAVE_VERSION");
            try(Cursor c=opened.rawQuery("PRAGMA quick_check",null)){Fault.require(c.moveToFirst()&&"ok".equals(c.getString(0)),"STORAGE_CORRUPT");}
            return opened;
        }catch(Exception e){opened.close();throw e;}
    }
    private void ready(){Fault.require(db!=null&&failure==null,failure==null?"STORAGE_ERROR":failure);}
    public synchronized JSONObject status(){return SaveCodec.record("storageAvailable",db!=null&&failure==null,"error",failure,"backupWarning",backupWarning);}
    public synchronized JSONObject load(){
        ready();try(Cursor c=db.rawQuery("SELECT revision, document FROM current_save WHERE singleton=1",null)){
            if(!c.moveToFirst())return null;JSONObject save=codec.validate(SaveCodec.parse(c.getString(1)));Fault.require(c.getLong(0)==SaveCodec.integer(save.opt("revision")),"STORAGE_CORRUPT");return save;
        }catch(Exception e){failure="STORAGE_CORRUPT";throw new Fault(failure);}
    }
    private void write(JSONObject save){
        // 首次把v1写成v2前另存原始JSON，不随日常五槽副本轮换；备份失败则整笔事务失败。
        try(Cursor old=db.rawQuery("SELECT document FROM current_save WHERE singleton=1",null)){if(old.moveToFirst()){String text=old.getString(0);JSONObject raw=SaveCodec.parse(text);if(Integer.valueOf(1).equals(raw.opt("formatVersion"))){File original=new File(directory,"format-v1-original.json");if(!original.exists())PrivateFiles.writeAtomic(original,text.getBytes(StandardCharsets.UTF_8),"SAVE_WRITE_FAILED");}}}
        db.execSQL("INSERT OR REPLACE INTO current_save(singleton, revision, document) VALUES(1,?,?)",new Object[]{SaveCodec.integer(save.opt("revision")),save.toString()});
    }
    public synchronized JSONObject initialize(JSONObject raw){
        ready();JSONObject save=codec.initial(raw);db.beginTransaction();
        try{Fault.require(load()==null,"REVISION_CONFLICT");write(save);db.setTransactionSuccessful();}catch(Fault e){throw e;}catch(Exception e){throw new Fault("SAVE_WRITE_FAILED");}finally{db.endTransaction();}
        try{backup(save,"initial");}catch(Fault e){backupWarning=e.code;}return save;
    }
    public synchronized JSONObject save(JSONObject raw,long expected){
        ready();JSONObject next=codec.validate(raw);db.beginTransaction();
        try {
            JSONObject current=load();Fault.require(current!=null,"INVALID_SAVE");
            Fault.require(SaveCodec.integer(current.opt("revision"))==expected&&expected<SaveCodec.MAX_INTEGER&&SaveCodec.integer(next.opt("revision"))==expected+1,"REVISION_CONFLICT");
            Fault.require(current.opt("id").equals(next.opt("id"))&&current.opt("createdAt").equals(next.opt("createdAt"))&&SaveCodec.str(next.opt("updatedAt")).compareTo(SaveCodec.str(current.opt("updatedAt")))>=0,"INVALID_SAVE");
            JSONObject pending=loadPending();boolean clear=codec.transition(current,next,pending);
            backup(current,"before-save");write(next);if(clear)db.execSQL("DELETE FROM pending_result WHERE singleton=1");db.setTransactionSuccessful();return next;
        }catch(Fault e){throw e;}catch(Exception e){throw new Fault("SAVE_WRITE_FAILED");}finally{db.endTransaction();}
    }
    public synchronized JSONObject importSave(JSONObject raw){
        JSONObject next=codec.validate(raw);ready();db.beginTransaction();
        try{JSONObject current=load();Fault.require(loadPending()==null,"BUSY");long revision=current==null?0:SaveCodec.integer(current.opt("revision"))+1;Fault.require(revision<=SaveCodec.MAX_INTEGER,"REVISION_CONFLICT");if(current!=null)backup(current,"before-import");SaveCodec.put(next,"revision",revision);write(next);db.setTransactionSuccessful();return next;}catch(Fault e){throw e;}catch(Exception e){throw new Fault("SAVE_WRITE_FAILED");}finally{db.endTransaction();}
    }
    public synchronized JSONObject loadPending(){
        ready();try(Cursor c=db.rawQuery("SELECT document FROM pending_result WHERE singleton=1",null)){
            if(!c.moveToFirst())return null;JSONObject raw=SaveCodec.parse(c.getString(0)),current=load();
            Fault.require(current!=null&&current.opt("id").equals(raw.opt("saveId")),"STORAGE_CORRUPT");String operation=SaveCodec.id(raw.opt("operationId"));Fault.require(operation.length()<=128,"STORAGE_CORRUPT");JSONArray ids=SaveCodec.parseArray(SaveCodec.recipeKey(raw.opt("ingredientIds")));JSONObject result=codec.card(raw.opt("result"));String now=SaveCodec.stamp(raw.opt("now"));
            JSONArray mods=SaveCodec.arr(current.opt("mods"),16);JSONObject source=codec.modCodec.source(raw.opt("source"),mods);JSONArray states=codec.modCodec.states(raw.opt("modStates"),mods);
            Object processed=raw.has("modProcessed")?raw.opt("modProcessed"):false;Fault.require(processed instanceof Boolean,"STORAGE_CORRUPT");
            return SaveCodec.record("saveId",current.opt("id"),"operationId",operation,"ingredientIds",ids,"result",result,"now",now,"source",source,"modStates",states,"modProcessed",processed);
        }catch(Exception e){failure="STORAGE_CORRUPT";throw new Fault(failure);}
    }
    public synchronized void putPending(JSONObject raw){
        ready();db.beginTransaction();try{JSONObject current=load();Fault.require(current!=null&&current.opt("id").equals(raw.opt("saveId")),"REVISION_CONFLICT");Fault.require(loadPending()==null,"BUSY");db.execSQL("INSERT INTO pending_result(singleton,document) VALUES(1,?)",new Object[]{raw.toString()});db.setTransactionSuccessful();}catch(Fault e){throw e;}catch(Exception e){throw new Fault("SAVE_WRITE_FAILED");}finally{db.endTransaction();}
    }
    public synchronized void updatePending(JSONObject raw,String operationId){
        ready();db.beginTransaction();try{JSONObject pending=loadPending();Fault.require(pending!=null&&operationId.equals(pending.opt("operationId")),"OPERATION_CONFLICT");Fault.require(pending.opt("saveId").equals(raw.opt("saveId"))&&pending.opt("now").equals(raw.opt("now"))&&SaveCodec.recipeKey(pending.opt("ingredientIds")).equals(SaveCodec.recipeKey(raw.opt("ingredientIds"))),"OPERATION_CONFLICT");db.execSQL("UPDATE pending_result SET document=? WHERE singleton=1",new Object[]{raw.toString()});db.setTransactionSuccessful();}catch(Fault e){throw e;}catch(Exception e){throw new Fault("SAVE_WRITE_FAILED");}finally{db.endTransaction();}
    }
    private void backup(JSONObject save,String reason){
        List<JSONObject> all=backupsInternal();Set<String> ids=new HashSet<>();for(JSONObject b:all)ids.add(SaveCodec.str(b.opt("id")));String slot=null;for(int i=0;i<5;i++)if(!ids.contains("slot-"+i)){slot="slot-"+i;break;}if(slot==null)slot=SaveCodec.str(all.get(all.size()-1).opt("id"));
        JSONObject envelope=SaveCodec.record("id",slot,"createdAt",SaveCodec.now(),"reason",reason,"save",codec.validate(save));
        PrivateFiles.writeAtomic(new File(directory,slot+".json"),envelope.toString().getBytes(StandardCharsets.UTF_8),"SAVE_WRITE_FAILED");backupWarning=null;
    }
    private List<JSONObject> backupsInternal(){
        List<JSONObject> result=new ArrayList<>();for(int i=0;i<5;i++){File file=new File(directory,"slot-"+i+".json");if(!file.exists())continue;try{JSONObject raw=SaveCodec.parse(new String(PrivateFiles.readAtomic(file,SaveCodec.MAX_BYTES+4096,"FILE_READ_FAILED"),StandardCharsets.UTF_8),SaveCodec.MAX_BYTES+4096),save=codec.validate(raw.opt("save"));result.add(SaveCodec.record("id","slot-"+i,"createdAt",SaveCodec.stamp(raw.opt("createdAt")),"reason",raw.opt("reason"),"save",save));}catch(Exception ignored){backupWarning="STORAGE_CORRUPT";}}
        result.sort((a,b)->SaveCodec.str(b.opt("createdAt")).compareTo(SaveCodec.str(a.opt("createdAt"))));return result;
    }
    public synchronized JSONArray listBackups(){JSONArray result=new JSONArray();for(JSONObject b:backupsInternal()){JSONObject s=SaveCodec.obj(b.opt("save"));result.put(SaveCodec.record("id",b.opt("id"),"saveId",s.opt("id"),"revision",s.opt("revision"),"createdAt",b.opt("createdAt"),"reason",b.opt("reason"),"cardCount",SaveCodec.arr(s.opt("cards"),25000).length(),"recipeCount",SaveCodec.arr(s.opt("recipes"),100000).length(),"updatedAt",s.opt("updatedAt"),"synthesisCount",SaveCodec.obj(s.opt("stats")).opt("synthesisCount")));}return result;}
    public synchronized JSONObject restore(String id){
        Fault.require(id.matches("slot-[0-4]"),"INVALID_SAVE");JSONObject chosen=null;for(JSONObject b:backupsInternal())if(id.equals(b.opt("id")))chosen=SaveCodec.obj(b.opt("save"));Fault.require(chosen!=null,"FILE_READ_FAILED");
        if(db!=null&&failure==null)return importSave(chosen);
        return recover(chosen);
    }
    public synchronized JSONObject recover(JSONObject raw){
        JSONObject save=codec.validate(raw);Fault.require(db==null||failure!=null,"REVISION_CONFLICT");
        // 写入全新的库并校验，再原子切换指针；原来的db/wal/shm均留在原地。
        String filename="game-recovery-"+UUID.randomUUID()+".sqlite";SQLiteDatabase replacement=null;
        try{replacement=open(filename);replacement.beginTransaction();try{SaveCodec.put(save,"revision",0);replacement.execSQL("INSERT INTO current_save(singleton,revision,document) VALUES(1,0,?)",new Object[]{save.toString()});replacement.setTransactionSuccessful();}finally{replacement.endTransaction();}
            PrivateFiles.writeAtomic(pointer,filename.getBytes(StandardCharsets.UTF_8),"SAVE_WRITE_FAILED");if(db!=null)db.close();db=replacement;replacement=null;failure=null;return load();
        }catch(Fault e){throw e;}catch(Exception e){throw new Fault("SAVE_WRITE_FAILED");}finally{if(replacement!=null)replacement.close();}
    }
    public synchronized void close(){if(db!=null)db.close();db=null;}
}
