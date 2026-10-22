package coc.logbook;

import java.lang.management.ManagementFactory;

/** Measures strict validation's allocation at its real public package boundary, without phone claims. */
public final class StrictJsonPerformanceCheck {
    public static void main(String[] args)throws Exception{
        StringBuilder json=new StringBuilder("{\"messages\":[");
        for(int i=0;i<2000;i++){if(i>0)json.append(',');json.append("{\"id\":\"public-message-").append(i).append("\",\"order\":").append(i).append(",\"displayName\":\"公开人物\",\"text\":\"公开完整正文\",\"isDiceCommand\":false,\"isOffTopic\":false,\"images\":[]}");}
        String input=json.append("]}").toString();
        for(int warm=0;warm<3;warm++)StrictBackupJson.validate(input);
        com.sun.management.ThreadMXBean meter=(com.sun.management.ThreadMXBean)ManagementFactory.getThreadMXBean();
        if(!meter.isThreadAllocatedMemorySupported())throw new AssertionError("Allocation meter required");
        meter.setThreadAllocatedMemoryEnabled(true);long id=Thread.currentThread().threadId(),before=meter.getThreadAllocatedBytes(id),start=System.nanoTime();
        StrictBackupJson.validate(input);
        long allocated=meter.getThreadAllocatedBytes(id)-before;
        System.out.println("PUBLIC_STRICT_JSON_ALLOCATION {\"characters\":"+input.length()+",\"messages\":2000,\"allocatedBytes\":"+allocated+",\"hostMilliseconds\":"+((System.nanoTime()-start)/1000000.0)+",\"phoneMeasurement\":false}");
        if(allocated>12L*1024*1024)throw new AssertionError("Strict validation allocates a full parser/regex graph per simple key or scalar: "+allocated);
        System.out.println("Strict JSON allocation check passed");
        org.json.JSONObject message=new org.json.JSONObject("{\"id\":\"public\",\"order\":0,\"displayName\":\"公开人物\",\"text\":\"完整正文\",\"type\":\"text\",\"isDiceCommand\":false,\"isOffTopic\":false,\"images\":[]}");
        org.json.JSONArray messages=new org.json.JSONArray();for(int i=0;i<2000;i++)messages.put(message);
        org.json.JSONObject row=new org.json.JSONObject("{\"id\":\"public\",\"moduleId\":\"public-module\",\"name\":\"公开场次\",\"order\":0,\"sequenceNo\":1,\"sourceType\":\"online\",\"link\":\"https://example.com\",\"status\":\"valid\",\"dateSource\":\"none\",\"createdAt\":\"public\",\"updatedAt\":\"public\"}");
        row.put("rawContent",new org.json.JSONObject().put("parserVersion",1).put("messages",messages));
        for(int warm=0;warm<3;warm++)BackupValidation.record(row);
        before=meter.getThreadAllocatedBytes(id);BackupValidation.record(row);allocated=meter.getThreadAllocatedBytes(id)-before;
        System.out.println("PUBLIC_BACKUP_SCHEMA_ALLOCATION {\"messages\":2000,\"allocatedBytes\":"+allocated+",\"phoneMeasurement\":false}");
        if(allocated>1024L*1024)throw new AssertionError("Known immutable validation field definitions must not be rebuilt per message: "+allocated);
    }
}
