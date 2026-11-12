package com.geometryworkshop.wxgc3;

import android.util.AtomicFile;
import java.io.*;

final class PrivateFiles {
    static byte[] read(InputStream stream, int max, String error) throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
        while((n=stream.read(buffer))!=-1){if(out.size()+n>max)throw new Fault(error);out.write(buffer,0,n);}return out.toByteArray();
    }
    static byte[] readAtomic(File path,int max,String error) {
        try(InputStream in=new AtomicFile(path).openRead()){return read(in,max,error);}catch(Fault e){throw e;}catch(Exception e){throw new Fault(error);}
    }
    static void writeAtomic(File path,byte[] data,String error) {
        AtomicFile file=new AtomicFile(path);FileOutputStream out=null;
        try{out=file.startWrite();out.write(data);file.finishWrite(out);}catch(Exception e){if(out!=null)file.failWrite(out);throw new Fault(error);}
    }
}
