package com.geometryworkshop.wxgc3;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONObject;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** API配置只以设备Keystore加密的密文落盘，与可导出存档完全分开。 */
final class SecretVault {
    private static final String ALIAS="wxgc3-candidate-api-v1";
    private static final byte[] AAD="wxgc3:api-config:1".getBytes(StandardCharsets.UTF_8);
    private final File secret,marker;
    SecretVault(Context context){secret=new File(context.getNoBackupFilesDir(),"api-config.enc");marker=new File(context.getNoBackupFilesDir(),"configured.marker");}
    boolean configured(){return marker.exists()||secret.exists();}
    private SecretKey key(boolean create) throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
        if(!create)throw new Fault("KEY_UNAVAILABLE");
        KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");gen.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).setRandomizedEncryptionRequired(true).build());return gen.generateKey();
    }
    synchronized JSONObject read(){
        if(!secret.exists())return null;
        try{byte[] bytes=PrivateFiles.readAtomic(secret,12288,"KEY_UNAVAILABLE");Fault.require(bytes.length>32&&bytes[0]==1,"KEY_UNAVAILABLE");int ivLength=bytes[1]&255;Fault.require(ivLength==12&&bytes.length>2+ivLength,"KEY_UNAVAILABLE");byte[] iv=new byte[ivLength];System.arraycopy(bytes,2,iv,0,ivLength);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(false),new GCMParameterSpec(128,iv));cipher.updateAAD(AAD);byte[] plain=cipher.doFinal(bytes,2+ivLength,bytes.length-2-ivLength);try{Fault.require(plain.length<=8192,"KEY_UNAVAILABLE");return SaveCodec.parse(new String(plain,StandardCharsets.UTF_8));}finally{java.util.Arrays.fill(plain,(byte)0);}}
        catch(Exception e){throw new Fault("KEY_UNAVAILABLE");}
    }
    synchronized void write(JSONObject value){
        byte[] plain=value.toString().getBytes(StandardCharsets.UTF_8);Fault.require(plain.length<=8192,"CONFIG_TOO_LARGE");
        try{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(true));cipher.updateAAD(AAD);byte[] encrypted=cipher.doFinal(plain),iv=cipher.getIV();Fault.require(iv.length==12,"KEY_UNAVAILABLE");ByteBuffer buffer=ByteBuffer.allocate(2+iv.length+encrypted.length);buffer.put((byte)1).put((byte)iv.length).put(iv).put(encrypted);PrivateFiles.writeAtomic(secret,buffer.array(),"KEY_UNAVAILABLE");
            // 成功密文自身也作为配置标记；辅助标记失败不撤销已经保存的有效配置。
            try{PrivateFiles.writeAtomic(marker,new byte[]{1},"KEY_UNAVAILABLE");}catch(Fault ignored){}
        }catch(Fault e){throw e;}catch(Exception e){throw new Fault("KEY_UNAVAILABLE");}finally{java.util.Arrays.fill(plain,(byte)0);}
    }
}
