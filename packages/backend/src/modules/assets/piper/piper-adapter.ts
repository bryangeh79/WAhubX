// M7 Day 3 · Piper TTS subprocess wrapper
//
// 调用方式:
//   piper.exe --model <model.onnx> --output_file <out.wav>
//   stdin 喂文本 · 退出后读 wav
//
// V1 约束:
//   - 仅生成 < 8s 语音 (避长音大陆腔暴露 · 补强 4)
//   - wav → opus 转换留给上层 (Day 4 AssetService · ffmpeg)
//
// 测试注入: execImpl callable · 返 { stdout, stderr, code }

import { spawn } from 'node:child_process';
import { Injectable } from '@nestjs/common';

export interface PiperExecResult {
  stdout: Buffer;
  stderr: Buffer;
  code: number | null;
}

export type PiperExecFn = (
  bin: string,
  args: string[],
  stdinText: string,
  timeoutMs: number,
) => Promise<PiperExecResult>;

export interface PiperGenerateParams {
  text: string;
  modelPath: string; // 'models/zh_CN-huayan-medium.onnx'
  outputPath: string; // 目标 wav
  /** 最大秒数 · 超时抛 */
  timeoutSec?: number;
}

@Injectable()
export class PiperAdapter {
  private readonly bin: string;
  private readonly exec: PiperExecFn;

  constructor(
    opts: { binPath?: string; exec?: PiperExecFn } = {},
  ) {
    this.bin = opts.binPath ?? 'piper.exe';
    this.exec = opts.exec ?? defaultSpawnExec;
  }

  async generate(params: PiperGenerateParams): Promise<PiperExecResult> {
    const args = ['--model', params.modelPath, '--output_file', params.outputPath];
    const timeoutMs = (params.timeoutSec ?? 30) * 1000;
    return this.exec(this.bin, args, params.text, timeoutMs);
  }
}

const defaultSpawnExec: PiperExecFn = (bin, args, stdinText, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`piper timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err),
        code,
      });
    });
    child.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.stdin.end(stdinText);
  });
