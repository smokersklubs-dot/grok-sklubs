import assert from "node:assert/strict";
import { test } from "node:test";
import { closeSync, copyFileSync, ftruncateSync, mkdtempSync, openSync, statSync, unlinkSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { validClips } from "../src/studioclips.js";

const dir = mkdtempSync(join(tmpdir(),"sklubot-layer-fixture-"));
process.env.DATA_DIR = dir;
process.env.DB_PATH = ":memory:";
process.env.NO_SCHEDULER = "1";
const { storeBytes, resolveInWorkspace } = await import("../src/computer.js");
const { storyFor } = await import("../src/videostudio.js");
const { publishStagedFile } = await import("../src/stagedfile.js");
const { docker } = await import("../src/linux.js");

const story = {title:"Cut",scenes:[{text:"A",seconds:2,style:"type",media:""}],
  aspect:"wide",audio:"",muted:false,offset:0};
const clip = {id:"one",name:"Line",kind:"audio",path:"audio/shared.wav",start:1.5,inPoint:.5,outPoint:2.5};

test("overlapping independent clips survive validation and remain private to their owner", () => {
  storeBytes("layers-owner","audio","shared.wav",Buffer.from("fixture"));
  const layered = {...story, clips:[clip, {...clip,id:"two",start:2}]};
  assert.equal(storyFor("layers-other",layered),null);
  assert.deepEqual(storyFor("layers-owner",layered)?.clips,layered.clips.map(c=>({...c,volume:1})));
  assert.deepEqual(storyFor("layers-owner",story),story);
  for (const bad of [[clip,clip],[{...clip,path:"uploads/../x.wav"}],[{...clip,inPoint:4}],
    [{...clip,start:300}],[{...clip,start:NaN}],[{...clip,volume:1.1}],
    [{...clip,kind:"visual",path:"audio/shared.wav"}]])
    assert.equal(validClips(bad),false);
});

test("one-gigabyte staged output publishes without duplicating bytes or rewriting a prior version", () => {
  const file = join(dir,"sparse-movie");
  const fd=openSync(file,"wx"); try { ftruncateSync(fd,1_000_000_000); } finally { closeSync(fd); }
  const movie=publishStagedFile("layers-owner","exports",file,"Sample.mp4",1_000_000_000);
  assert.equal(movie.size,1_000_000_000);
  const full=resolveInWorkspace("layers-owner",movie.path);
  assert.equal(statSync(file,{bigint:true}).ino,statSync(full,{bigint:true}).ino);
  assert.equal(publishStagedFile("layers-owner","exports",file,"Sample.mp4",movie.size).path,movie.path);
  unlinkSync(full);
  unlinkSync(file);
});

test("render transport drains a large stream, applies backpressure and fails on overflow", async () => {
  const fake=join(dir,process.platform === "win32" ? "docker.exe" : "docker");
  copyFileSync(process.execPath,fake);
  const original=process.env.PATH;
  process.env.PATH=dir+delimiter+original;
  try {
    const limit=85*1024*1024;
    const writer="const buf=Buffer.alloc(65536,42); for(let i=0;i<1360;i++) if(!process.stdout.write(buf)) await new Promise(r=>process.stdout.once('drain',r))";
    let count=0;
    const result=await docker(["--input-type=module","-e",writer],{maxBytes:limit,output:async chunk=>{
      assert.equal(chunk[0],42); count+=chunk.length;
    }});
    assert.equal(result.code,0,result.stderr); assert.equal(result.stdout.length,0); assert.equal(count,limit);
    const overflow=await docker(["--input-type=module","-e",writer],{maxBytes:1024,output:async()=>{}});
    assert.notEqual(overflow.code,0); assert.match(overflow.stderr,/TOO_LARGE/);
  } finally { process.env.PATH=original; unlinkSync(fake); }
});
