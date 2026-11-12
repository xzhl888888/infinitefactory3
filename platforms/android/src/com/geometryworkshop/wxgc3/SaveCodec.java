package com.geometryworkshop.wxgc3;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.*;

/** 与src/core/model.js的v2白名单一致，v1只读升级；不执行导入档内的Mod源码。 */
final class SaveCodec {
    static final int MAX_BYTES = 32 * 1024 * 1024;
    static final long MAX_INTEGER = 9007199254740991L;
    static final String WS = "[\\u0009-\\u000d \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+";
    static final String CONTROLS = "[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]";
    static final DateTimeFormatter ISO = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
    final JSONObject catalog;
    final ModCodec modCodec;
    SaveCodec(JSONObject catalog) { this.catalog = catalog;modCodec=new ModCodec(this); }
    static JSONObject obj(Object value) { Fault.require(value instanceof JSONObject, "INVALID_SAVE"); return (JSONObject)value; }
    static JSONArray arr(Object value, int max) { Fault.require(value instanceof JSONArray && ((JSONArray)value).length() <= max, "INVALID_SAVE"); return (JSONArray)value; }
    static String str(Object value) { Fault.require(value instanceof String, "INVALID_SAVE"); return (String)value; }
    static Object get(JSONObject o, String key) { Object v=o.opt(key); Fault.require(v != null && v != JSONObject.NULL, "INVALID_SAVE"); return v; }
    static void put(JSONObject o, String key, Object value) { try { o.put(key, value == null ? JSONObject.NULL : value); } catch(Exception e) { throw new Fault("INVALID_SAVE"); } }
    static JSONObject record(Object... values) { JSONObject o=new JSONObject(); for(int i=0;i<values.length;i+=2) put(o,(String)values[i],values[i+1]); return o; }
    static long integer(Object v) {
        Fault.require(v instanceof Number, "INVALID_SAVE"); double d=((Number)v).doubleValue();
        Fault.require(Double.isFinite(d) && d >= 0 && d <= MAX_INTEGER && d == Math.rint(d), "INVALID_SAVE"); return ((Number)v).longValue();
    }
    static String id(Object value) { String v=str(value); Fault.require(v.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,159}"),"INVALID_ID"); return v; }
    static String stamp(Object v) {
        try {
            Instant i;
            if(v instanceof Number) i=Instant.ofEpochMilli(((Number)v).longValue());
            else { String s=str(v); try { i=Instant.parse(s); } catch(Exception ex) { i=OffsetDateTime.parse(s).toInstant(); } }
            Fault.require(Math.abs(i.toEpochMilli()) <= 8640000000000000L,"INVALID_TIMESTAMP"); return ISO.format(i);
        } catch(Exception ex) { throw new Fault("INVALID_TIMESTAMP"); }
    }
    static String now() { return ISO.format(Instant.now()); }
    static boolean has(JSONArray a, String v) { for(int i=0;i<a.length();i++) if(v.equals(a.opt(i)))return true; return false; }
    static String cleanText(Object value,int limit) {
        Fault.require(value instanceof String,"INVALID_CARD_RESULT");
        String v=Normalizer.normalize((String)value,Normalizer.Form.NFC).replaceAll(WS," ").trim();
        Fault.require(!v.isEmpty() && v.codePointCount(0,v.length())<=limit && !v.matches("(?s).*"+CONTROLS+".*"),"INVALID_CARD_RESULT"); return v;
    }
    static String normalizedName(String v) { return Normalizer.normalize(v,Normalizer.Form.NFKC).replaceAll(WS," ").trim().toLowerCase(Locale.ROOT); }
    JSONObject card(Object raw) {
        JSONObject c=obj(raw),limits=obj(get(catalog,"limits"));
        String name=cleanText(c.opt("name"),(int)integer(get(limits,"name")));
        String emoji=cleanText(c.opt("emoji"),(int)integer(get(limits,"emoji")));
        String category=cleanText(c.opt("category"),8);
        String description=cleanText(c.opt("description"),(int)integer(get(limits,"description")));
        Fault.require(has(arr(get(catalog,"categories"),20),category),"INVALID_CARD_RESULT");
        return record("name",name,"emoji",emoji,"category",category,"description",description);
    }
    static String recipeKey(Object raw) {
        JSONArray a=arr(raw,4); Fault.require(a.length()>=2,"INVALID_INGREDIENT_COUNT");
        List<String> ids=new ArrayList<>(); for(int i=0;i<a.length();i++) ids.add(id(a.opt(i))); Collections.sort(ids);
        return new JSONArray(ids).toString();
    }
    static JSONObject parse(String text) {
        return parse(text,MAX_BYTES);
    }
    static JSONObject parse(String text,int maxBytes) {
        Fault.require(text != null && text.getBytes(StandardCharsets.UTF_8).length<=maxBytes,"SAVE_TOO_LARGE");
        // 先限嵌套层数，避免畸形分享文件在org.json解析前耗尽Java栈；引号内的脚本不计结构深度。
        int depth=0;boolean quoted=false,escaped=false;for(int i=0;i<text.length();i++){char c=text.charAt(i);if(quoted){if(escaped)escaped=false;else if(c=='\\')escaped=true;else if(c=='"')quoted=false;}else if(c=='"')quoted=true;else if(c=='{'||c=='['){depth++;Fault.require(depth<=64,"INVALID_SAVE");}else if(c=='}'||c==']'){depth--;Fault.require(depth>=0,"INVALID_SAVE");}}
        Fault.require(depth==0&&!quoted,"INVALID_SAVE");
        try { JSONTokener t=new JSONTokener(text); Object value=t.nextValue(); Fault.require(t.nextClean()==0,"INVALID_SAVE"); return obj(value); }
        catch(Fault e){throw e;} catch(Exception e){throw new Fault("INVALID_SAVE");}
    }
    static JSONArray parseArray(String text) { try{return new JSONArray(text);}catch(Exception e){throw new Fault("INVALID_SAVE");} }
    JSONObject preferences(Object raw,JSONArray mods) {
        JSONObject source=obj(raw),result=parse(obj(get(catalog,"preferences")).toString()),appearance=obj(get(catalog,"appearance"));
        for(String key:new String[]{"skinId","tabletopId","cardBackId"}) if(source.has(key)) { String v=str(source.opt(key));boolean allowed=has(arr(get(appearance,key),30),v);String kind=key.equals("skinId")?"skins":key.equals("tabletopId")?"tabletops":"cardBacks";for(int i=0;i<mods.length()&&!allowed;i++){JSONObject manifest=obj(obj(mods.opt(i)).opt("manifest"));JSONArray options=arr(manifest.opt(kind),20);for(int j=0;j<options.length();j++)if(v.equals("mod/"+str(manifest.opt("id"))+"/"+kind+"/"+str(obj(options.opt(j)).opt("id"))))allowed=true;}Fault.require(allowed,"INVALID_SAVE");put(result,key,v); }
        for(String key:new String[]{"soundEnabled","musicEnabled","reduceMotion","layoutInitialized"}) if(source.has(key)) { Object v=source.opt(key);Fault.require(v instanceof Boolean,"INVALID_SAVE");put(result,key,v); }
        if(source.has("zoom")){Object v=source.opt("zoom");Fault.require(v instanceof Number,"INVALID_SAVE");double n=((Number)v).doubleValue();Fault.require(Double.isFinite(n)&&n>=.25&&n<=4,"INVALID_SAVE");put(result,"zoom",n);}
        if(source.has("synthesisPrompt"))put(result,"synthesisPrompt",synthesisPrompt(source.opt("synthesisPrompt")));return result;
    }
    // 与JS按UTF-16长度核对，保留玩家的换行和空格；默认正文与长度来自同一份构建目录。
    String synthesisPrompt(Object raw) {
        Fault.require(raw instanceof String,"INVALID_SAVE");String value=(String)raw;int limit=((Number)obj(catalog.opt("prompt")).opt("limit")).intValue();
        Fault.require(value.length()<=limit&&!value.matches("(?s).*[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069].*"),"INVALID_SAVE");return value;
    }
    String fingerprint(Object raw) {
        String text=str(raw);Fault.require(text.length()<=4096,"INVALID_SAVE");JSONObject f=parse(text);
        return record("ingredientIds",parseArray(recipeKey(f.opt("ingredientIds"))),"result",f.isNull("result")?JSONObject.NULL:card(f.opt("result"))).toString();
    }
    JSONObject validate(Object raw) {
        JSONObject s=obj(raw);boolean old=Integer.valueOf(1).equals(s.opt("formatVersion"));Fault.require(old||Integer.valueOf(2).equals(s.opt("formatVersion")),"UNSUPPORTED_SAVE_VERSION");Fault.require(Integer.valueOf(1).equals(s.opt("contentVersion")),"UNSUPPORTED_CONTENT_VERSION");
        String saveName=old?"我的世界":str(ModCodec.or(s.opt("name"),"我的世界")),trimmedName=saveName.replaceAll("^"+WS+"|"+WS+"$","");Fault.require(!trimmedName.isEmpty()&&saveName.codePointCount(0,saveName.length())<=40&&!saveName.matches("(?s).*[\\u0000-\\u001f\\u007f].*"),"INVALID_SAVE");saveName=trimmedName;JSONArray mods=old?new JSONArray():modCodec.mods(s.opt("mods"));
        String saveId=id(s.opt("id")),created=stamp(s.opt("createdAt")),updated=stamp(s.opt("updatedAt"));Fault.require(updated.compareTo(created)>=0,"INVALID_TIMESTAMP");long rev=integer(s.opt("revision"));
        Map<String,JSONObject> cardsById=new LinkedHashMap<>();Set<String> names=new HashSet<>();JSONArray cards=new JSONArray(),source=arr(s.opt("cards"),25000);int baseCount=0;
        for(int i=0;i<source.length();i++) {
            JSONObject rawCard=obj(source.opt(i)),c=card(rawCard);String cid=id(rawCard.opt("id"));
            Fault.require(!cardsById.containsKey(cid),"DUPLICATE_ID");Fault.require(names.add(normalizedName(str(c.opt("name")))),"DUPLICATE_CARD_NAME");Object isBase=rawCard.opt("isBase");Fault.require(isBase instanceof Boolean,"INVALID_SAVE");if((Boolean)isBase)baseCount++;
            put(c,"id",cid);put(c,"isBase",isBase);put(c,"discoveredAt",stamp(rawCard.opt("discoveredAt")));cardsById.put(cid,c);cards.put(c);
        }
        JSONArray bases=arr(catalog.opt("bases"),5);Fault.require(bases.length()==5 && baseCount==5,"INVALID_BASE_CARDS");
        for(int i=0;i<bases.length();i++) {JSONObject base=obj(bases.opt(i)),c=cardsById.get(base.opt("id"));Fault.require(c!=null && Boolean.TRUE.equals(c.opt("isBase")),"INVALID_BASE_CARDS");for(String field:new String[]{"name","emoji","category","description"})Fault.require(base.opt(field).equals(c.opt(field)),"INVALID_BASE_CARDS");}
        JSONArray recipes=new JSONArray();Map<String,JSONObject> recipesByKey=new HashMap<>();source=arr(s.opt("recipes"),100000);
        for(int i=0;i<source.length();i++) {JSONObject r=obj(source.opt(i));String key=recipeKey(r.opt("ingredientIds")),resultId=id(r.opt("resultId"));Fault.require(key.equals(r.opt("key"))&&!recipesByKey.containsKey(key),"INVALID_RECIPE_KEY");JSONArray ingredients=parseArray(key);for(int j=0;j<ingredients.length();j++)Fault.require(cardsById.containsKey(ingredients.opt(j)),"INVALID_CARD_REFERENCE");Fault.require(cardsById.containsKey(resultId),"INVALID_CARD_REFERENCE");JSONObject clean=record("key",key,"ingredientIds",ingredients,"resultId",resultId,"createdAt",stamp(r.opt("createdAt")));recipesByKey.put(key,clean);recipes.put(clean);}
        JSONArray operations=new JSONArray();Set<String> opIds=new HashSet<>();source=arr(s.opt("operations"),100000);
        for(int i=0;i<source.length();i++){JSONObject op=obj(source.opt(i));String oid=id(op.opt("id")),fp=fingerprint(op.opt("fingerprint")),key=recipeKey(parse(fp).opt("ingredientIds"));Fault.require(opIds.add(oid),"DUPLICATE_ID");JSONObject recipe=recipesByKey.get(op.opt("recipeKey"));Fault.require(recipe!=null && key.equals(recipe.opt("key")) && recipe.opt("resultId").equals(op.opt("resultId")),"INVALID_OPERATION_REFERENCE");operations.put(record("id",oid,"recipeKey",key,"resultId",recipe.opt("resultId"),"completedAt",stamp(op.opt("completedAt")),"fingerprint",fp,"source",modCodec.source(op.opt("source"),null)));}
        long count=integer(obj(s.opt("stats")).opt("synthesisCount"));Fault.require(count==operations.length(),"INVALID_STATISTICS");
        JSONArray favorites=new JSONArray();Set<String> folderIds=new HashSet<>();source=arr(s.opt("favorites"),100);
        for(int i=0;i<source.length();i++){JSONObject f=obj(source.opt(i));String fid=id(f.opt("id")),name=str(f.opt("name"));Fault.require(folderIds.add(fid)&&!name.trim().isEmpty()&&name.codePointCount(0,name.length())<=40&&!name.matches("(?s).*[\\u0000-\\u001f\\u007f].*"),"INVALID_SAVE");JSONArray rawIds=arr(f.opt("cardIds"),25000),ids=new JSONArray();Set<String> seen=new HashSet<>();for(int j=0;j<rawIds.length();j++){String cid=id(rawIds.opt(j));Fault.require(cardsById.containsKey(cid)&&seen.add(cid),"INVALID_CARD_REFERENCE");ids.put(cid);}favorites.put(record("id",fid,"name",name.trim(),"cardIds",ids));}
        JSONArray layout=new JSONArray();Set<String> instances=new HashSet<>();source=arr(s.opt("layout"),20000);
        for(int i=0;i<source.length();i++){JSONObject l=obj(source.opt(i));String lid=id(l.opt("id")),cid=id(l.opt("cardId"));Fault.require(instances.add(lid)&&cardsById.containsKey(cid),"INVALID_CARD_REFERENCE");for(String k:new String[]{"x","y"}){Object n=l.opt(k);Fault.require(n instanceof Number&&Double.isFinite(((Number)n).doubleValue())&&Math.abs(((Number)n).doubleValue())<=10000000,"INVALID_SAVE");}Object pinned=l.has("pinned")?l.opt("pinned"):false;Fault.require(pinned instanceof Boolean,"INVALID_SAVE");layout.put(record("id",lid,"cardId",cid,"x",l.opt("x"),"y",l.opt("y"),"pinned",pinned));}
        JSONObject result=record("formatVersion",2,"contentVersion",1,"id",saveId,"name",saveName,"mods",mods,"createdAt",created,"updatedAt",updated,"revision",rev,"cards",cards,"recipes",recipes,"stats",record("synthesisCount",count),"preferences",preferences(s.opt("preferences"),mods),"favorites",favorites,"layout",layout,"operations",operations);
        Fault.require(result.toString().getBytes(StandardCharsets.UTF_8).length<=MAX_BYTES,"SAVE_TOO_LARGE");return result;
    }
    JSONObject initial(Object raw) { JSONObject save=validate(raw);Fault.require(integer(save.opt("revision"))==0&&arr(save.opt("cards"),25000).length()==5&&arr(save.opt("recipes"),100000).length()==0&&arr(save.opt("operations"),100000).length()==0&&arr(save.opt("mods"),16).length()==0&&integer(obj(save.opt("stats")).opt("synthesisCount"))==0,"INVALID_SAVE");return save; }
    static boolean same(Object a,Object b){
        if(a==b)return true;if(a==null||b==null)return false;
        if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;Iterator<String> keys=x.keys();while(keys.hasNext()){String key=keys.next();if(!y.has(key)||!same(x.opt(key),y.opt(key)))return false;}return true;}
        if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!same(x.opt(i),y.opt(i)))return false;return true;}
        if(a instanceof Number&&b instanceof Number)return ((Number)a).doubleValue()==((Number)b).doubleValue();return a.equals(b);
    }
    static Map<String,JSONObject> indexed(JSONArray values,String key){Map<String,JSONObject> out=new LinkedHashMap<>();for(int i=0;i<values.length();i++){JSONObject v=obj(values.opt(i));out.put(str(v.opt(key)),v);}return out;}
    static void retains(Map<String,JSONObject> old,Map<String,JSONObject> next){for(Map.Entry<String,JSONObject> e:old.entrySet())Fault.require(same(e.getValue(),next.get(e.getKey())),"INVALID_SAVE");}
    /** 普通保存只允许偏好/台面变化或一笔完整合成；不能借快照删除发现或替换已落盘答案。 */
    boolean transition(JSONObject current,JSONObject next,JSONObject pending){
        Map<String,JSONObject> oldCards=indexed(arr(current.opt("cards"),25000),"id"),newCards=indexed(arr(next.opt("cards"),25000),"id");
        Map<String,JSONObject> oldRecipes=indexed(arr(current.opt("recipes"),100000),"key"),newRecipes=indexed(arr(next.opt("recipes"),100000),"key");
        Map<String,JSONObject> oldOps=indexed(arr(current.opt("operations"),100000),"id"),newOps=indexed(arr(next.opt("operations"),100000),"id");
        retains(oldCards,newCards);retains(oldRecipes,newRecipes);retains(oldOps,newOps);List<JSONObject> additions=new ArrayList<>();for(Map.Entry<String,JSONObject> e:newOps.entrySet())if(!oldOps.containsKey(e.getKey()))additions.add(e.getValue());
        Fault.require(additions.size()<=1,"INVALID_SAVE");
        if(additions.isEmpty()){
            Fault.require(newRecipes.size()==oldRecipes.size(),"INVALID_SAVE");JSONArray installed=arr(next.opt("mods"),16);if(pending!=null)Fault.require(same(current.opt("mods"),next.opt("mods"))&&newCards.size()==oldCards.size(),"PENDING_SAVE_REQUIRED");
            int added=0;for(Map.Entry<String,JSONObject> entry:newCards.entrySet())if(!oldCards.containsKey(entry.getKey())){
                added++;JSONObject card=entry.getValue();java.util.regex.Matcher match=java.util.regex.Pattern.compile("^mod:([a-z0-9][a-z0-9._-]{0,47}):([0-9]+):([0-9]+)x*$").matcher(entry.getKey());Fault.require(match.matches(),"INVALID_SAVE");
                Fault.require(match.group(2).equals(String.valueOf(integer(current.opt("revision"))))&&ModCodec.findEnabled(installed,match.group(1))!=null&&Boolean.FALSE.equals(card.opt("isBase"))&&current.opt("updatedAt").equals(card.opt("discoveredAt")),"INVALID_SAVE");
            }Fault.require(added<=50,"INVALID_SAVE");return false;
        }
        JSONObject op=additions.get(0),fp=parse(str(op.opt("fingerprint")));String key=recipeKey(fp.opt("ingredientIds"));
        if(pending==null){JSONObject known=oldRecipes.get(key);Fault.require(known!=null&&newCards.size()==oldCards.size()&&newRecipes.size()==oldRecipes.size()&&known.opt("resultId").equals(op.opt("resultId")),"RESULT_REQUIRED");if(!fp.isNull("result"))Fault.require(same(card(fp.opt("result")),card(oldCards.get(known.opt("resultId")))),"OPERATION_CONFLICT");Fault.require(same(current.opt("mods"),next.opt("mods"))&&same(op.opt("source"),record("kind","recipe")),"OPERATION_CONFLICT");return false;}
        // 没有启用 Mod 时，前端直接保存 AI 原答案；有启用项时仍须先持久化 Mod 处理结果。
        JSONArray installedMods = arr(current.opt("mods"),16);
        for (int i = 0; i < installedMods.length(); i++) {
            if (Boolean.TRUE.equals(obj(installedMods.opt(i)).opt("enabled"))) {
                Fault.require(!pending.has("modProcessed") || Boolean.TRUE.equals(pending.opt("modProcessed")), "PENDING_MOD_PROCESSING");
            }
        }
        Fault.require(pending.opt("saveId").equals(current.opt("id"))&&pending.opt("operationId").equals(op.opt("id"))&&key.equals(recipeKey(pending.opt("ingredientIds")))&&same(card(pending.opt("result")),card(fp.opt("result"))),"OPERATION_CONFLICT");
        String at=stamp(pending.opt("now"));if(at.compareTo(str(current.opt("updatedAt")))<0)at=str(current.opt("updatedAt"));Fault.require(at.equals(op.opt("completedAt")),"OPERATION_CONFLICT");
        JSONArray currentMods=arr(current.opt("mods"),16),changes=modCodec.states(pending.opt("modStates"),currentMods),expectedMods=parse(record("mods",currentMods).toString()).optJSONArray("mods");
        for(int i=0;i<changes.length();i++){JSONObject change=obj(changes.opt(i));for(int j=0;j<expectedMods.length();j++){JSONObject item=obj(expectedMods.opt(j));if(change.opt("id").equals(obj(item.opt("manifest")).opt("id")))put(item,"state",change.opt("state"));}}
        Fault.require(same(op.opt("source"),modCodec.source(pending.opt("source"),null))&&same(next.opt("mods"),expectedMods),"OPERATION_CONFLICT");
        if(oldRecipes.containsKey(key)){JSONObject known=oldRecipes.get(key);Fault.require(newCards.size()==oldCards.size()&&newRecipes.size()==oldRecipes.size()&&known.opt("resultId").equals(op.opt("resultId"))&&same(card(oldCards.get(known.opt("resultId"))),card(pending.opt("result"))),"OPERATION_CONFLICT");return true;}
        JSONObject answer=card(pending.opt("result")),existing=null;for(JSONObject c:oldCards.values())if(normalizedName(str(c.opt("name"))).equals(normalizedName(str(answer.opt("name")))))existing=c;
        String resultId;if(existing!=null){resultId=str(existing.opt("id"));Fault.require(newCards.size()==oldCards.size(),"OPERATION_CONFLICT");}
        else{resultId="card:"+str(op.opt("id"));JSONObject actual=newCards.get(resultId);Fault.require(actual!=null&&same(card(actual),answer)&&at.equals(actual.opt("discoveredAt"))&&Boolean.FALSE.equals(actual.opt("isBase"))&&newCards.size()==oldCards.size()+1,"OPERATION_CONFLICT");}
        Fault.require(resultId.equals(op.opt("resultId"))&&!oldRecipes.containsKey(key)&&newRecipes.size()==oldRecipes.size()+1,"OPERATION_CONFLICT");
        JSONObject recipe=newRecipes.get(key);Fault.require(recipe!=null&&resultId.equals(recipe.opt("resultId"))&&at.equals(recipe.opt("createdAt")),"OPERATION_CONFLICT");return true;
    }
}
