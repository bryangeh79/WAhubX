import * as crypto from 'node:crypto';
import { AiEncryptionService } from './ai-encryption.service';
import type { MasterKeyProvider } from './master-key.provider';

function buildSvc(keyHex?: string): AiEncryptionService {
  const key = Buffer.from(keyHex ?? crypto.randomBytes(32).toString('hex'), 'hex');
  const provider: MasterKeyProvider = {
    getKey: () => key,
    source: () => 'test:fixed',
  };
  return new AiEncryptionService(provider);
}

describe('AiEncryptionService', () => {
  it('roundtrip encrypt → decrypt returns original plaintext', () => {
    const svc = buildSvc();
    const plain = 'sk-test-1234567890abcdef';
    const cipher = svc.encrypt(plain);
    expect(cipher).not.toContain(plain);
    expect(cipher.startsWith('gcm:v1:')).toBe(true);
    expect(svc.decrypt(cipher)).toBe(plain);
  });

  it('two encryptions of same plaintext produce different ciphertexts (random IV)', () => {
    const svc = buildSvc();
    const plain = 'same-input';
    const c1 = svc.encrypt(plain);
    const c2 = svc.encrypt(plain);
    expect(c1).not.toBe(c2);
    expect(svc.decrypt(c1)).toBe(plain);
    expect(svc.decrypt(c2)).toBe(plain);
  });

  it('tampered ciphertext fails authentication', () => {
    const svc = buildSvc();
    const cipher = svc.encrypt('secret');
    // 篡改一个字节
    const parts = cipher.split(':');
    const tamperedCt = (parseInt(parts[3].slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0')
      + parts[3].slice(2);
    parts[3] = tamperedCt;
    const tampered = parts.join(':');
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it('wrong master key fails decryption', () => {
    const key1 = crypto.randomBytes(32).toString('hex');
    const key2 = crypto.randomBytes(32).toString('hex');
    const cipher = buildSvc(key1).encrypt('plain');
    expect(() => buildSvc(key2).decrypt(cipher)).toThrow();
  });

  it('rejects invalid format', () => {
    const svc = buildSvc();
    expect(() => svc.decrypt('not-valid')).toThrow(/invalid ciphertext format/);
    expect(() => svc.decrypt('aes:v1:aa:bb:cc')).toThrow(/unsupported ciphertext version/);
  });

  it('maskKey redacts middle of key', () => {
    const svc = buildSvc();
    expect(svc.maskKey('sk-ab1234cdef')).toBe('sk-a***def');
    expect(svc.maskKey('abc')).toBe('***');
    expect(svc.maskKey('')).toBe('');
  });
});
