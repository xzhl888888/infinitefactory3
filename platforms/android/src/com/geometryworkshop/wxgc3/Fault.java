package com.geometryworkshop.wxgc3;

/** 只允许稳定的错误码离开原生层；供应商正文、路径和凭据不进入日志或页面。 */
final class Fault extends RuntimeException {
    final String code;
    Fault(String code) { super(code, null, false, false); this.code = code; }
    static void require(boolean condition, String code) { if (!condition) throw new Fault(code); }
}
