package com.geometryworkshop.wxgc3;

import org.json.JSONArray;
import org.json.JSONObject;

/** 每个档位独立实现这些能力；注册表不接触槽内事务和凭据。 */
interface SlotStorage {
    JSONObject status();
    JSONObject load();
    JSONObject initialize(JSONObject save);
    JSONObject save(JSONObject save,long expectedRevision);
    JSONObject importSave(JSONObject save);
    JSONObject loadPending();
    void putPending(JSONObject pending);
    void updatePending(JSONObject pending,String operationId);
    JSONArray listBackups();
    JSONObject restore(String id);
    JSONObject recover(JSONObject save);
    void close();
}
