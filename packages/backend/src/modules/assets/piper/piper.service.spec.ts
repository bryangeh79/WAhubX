// M7 Day 3 · PiperService + PiperAdapter UT
import { PiperAdapter } from './piper-adapter';
import { PiperService, estimateDurationSec } from './piper.service';
import type { PersonaV1 } from '../persona.types';
import { EthnicityMY } from '../persona.types';

function buildPersona(primary: string): PersonaV1 {
  return {
    persona_id: 'p_test_01',
    display_name: 'Test',
    wa_nickname: 'T',
    gender: 'female',
    age: 28,
    ethnicity: EthnicityMY.ChineseMalaysian,
    country: 'MY',
    city: 'Petaling Jaya',
    occupation: '测试',
    languages: { primary, secondary: [], code_switching: false },
    personality: ['test'],
    speech_habits: {
      sentence_endings: ['啦', 'lah', 'lor'],
      common_phrases: ['a', 'b', 'c'],
      emoji_preference: ['😊', '🙈'],
      typing_style: '短句',
      avg_msg_length: 12,
    },
    interests: ['a', 'b', 'c'],
    activity_schedule: {
      timezone: 'Asia/Kuala_Lumpur',
      wake_up: '08:00',
      sleep: '23:00',
      peak_hours: ['12:00-13:00'],
      work_hours: '09:00-18:00',
    },
    avatar_prompt: 'a 28 year old Chinese Malaysian woman',
    signature_candidates: ['test'],
    persona_lock: true,
  };
}

describe('PiperService', () => {
  it('selectModel · zh primary → huayan · 非 zh → amy', () => {
    const svc = new PiperService(new PiperAdapter());
    expect(svc.selectModel(buildPersona('zh-CN'))).toContain('huayan');
    expect(svc.selectModel(buildPersona('en-US'))).toContain('amy');
    expect(svc.selectModel(buildPersona('ms-MY'))).toContain('amy'); // 非 zh fallback en
  });

  it('pickText · casual_laugh pool 取样 · 返 pool 里的字符串', () => {
    const svc = new PiperService(new PiperAdapter());
    const picks = new Set<string>();
    for (let i = 0; i < 20; i++) picks.add(svc.pickText('casual_laugh'));
    expect(picks.size).toBeGreaterThan(0);
    for (const s of picks) {
      expect(['哈哈哈哈哈', '嘿嘿嘿', '噗哈哈', '哎呀哈哈']).toContain(s);
    }
  });

  it('generate · text 超 8s 预估 · 抛 · 不调 piper', async () => {
    let execCalled = false;
    const adapter = new PiperAdapter({
      exec: async () => {
        execCalled = true;
        return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), code: 0 };
      },
    });
    const svc = new PiperService(adapter);
    const longText = '这是一段很长很长很长很长很长很长很长很长很长很长很长的中文文本它肯定超过八秒语音时长';
    await expect(
      svc.generate({
        persona: buildPersona('zh-CN'),
        category: 'short_reply',
        overrideText: longText,
        outputPath: '/tmp/out.wav',
      }),
    ).rejects.toThrow(/超 8s/);
    expect(execCalled).toBe(false);
  });

  it('generate · piper 成功 · 返 wavPath + modelUsed · 调用 adapter 一次', async () => {
    const calls: Array<{ bin: string; args: string[]; text: string }> = [];
    const adapter = new PiperAdapter({
      exec: async (bin, args, stdinText) => {
        calls.push({ bin, args, text: stdinText });
        return { stdout: Buffer.alloc(44), stderr: Buffer.alloc(0), code: 0 };
      },
    });
    const svc = new PiperService(adapter);
    const result = await svc.generate({
      persona: buildPersona('zh-CN'),
      category: 'greeting',
      overrideText: '早',
      outputPath: '/tmp/zh-greeting.wav',
      modelsDir: '/models',
    });
    expect(result.wavPath).toBe('/tmp/zh-greeting.wav');
    expect(result.modelUsed).toContain('huayan');
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('--model');
    expect(calls[0].args.find((a) => a.endsWith('.onnx'))).toContain('huayan');
    expect(calls[0].text).toBe('早');
  });
});

describe('estimateDurationSec', () => {
  it('短中文 · 低秒数', () => {
    expect(estimateDurationSec('早')).toBeLessThan(2);
  });
  it('长中文 · 超 8s', () => {
    expect(estimateDurationSec('这是一段很长的文本'.repeat(10))).toBeGreaterThan(8);
  });
});
