// A compact stack VM for make.fun's tiny-stack ISA v1, written for the
// tiny-stack-vm-01-run-20261122 bounty. A single run answers every instance
// in MAKEFUN_INPUT_DIR: each program.bin is executed on its input.bin and
// the entry writes stdout.bin and exit.txt for it under MAKEFUN_OUTPUT_DIR.
// Plain Node with no dependencies and no environment secrets: all of the
// code that runs is in this file.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Facts per opcode byte, filled in below: immediate byte count, how many
// values the instruction pops and how many it pushes. A slot whose DEF flag
// stays 0 is not an opcode at all and traps 5 when fetched.
const IMM = new Uint8Array(84), POP = new Uint8Array(84), PSH = new Uint8Array(84), DEF = new Uint8Array(84);
const def = (op, imm, pops, pushes) => { DEF[op] = 1; IMM[op] = imm; POP[op] = pops; PSH[op] = pushes; };
def(0x00, 0, 0, 0); // HALT
def(0x01, 1, 0, 1); // PUSH8
def(0x02, 4, 0, 1); // PUSH32
def(0x03, 0, 1, 0); // POP
def(0x04, 0, 1, 2); // DUP
def(0x05, 0, 2, 2); // SWAP
def(0x06, 0, 2, 3); // OVER
def(0x07, 0, 3, 3); // ROT
for (let op = 0x10; op <= 0x22; op++) def(op, 0, 2, 1); // the binary block
def(0x17, 0, 1, 1); // NEG is unary, not binary
def(0x1b, 0, 1, 1); // NOT is unary, not binary
def(0x30, 2, 0, 0); // JMP
def(0x31, 2, 1, 0); // JZ
def(0x32, 2, 1, 0); // JNZ
def(0x33, 2, 0, 0); // CALL
def(0x34, 0, 0, 0); // RET
def(0x40, 0, 1, 1); // LOAD
def(0x41, 0, 2, 0); // STORE
def(0x50, 0, 1, 0); // PRINT
def(0x51, 0, 1, 0); // PUTC
def(0x52, 0, 0, 1); // IN
def(0x53, 0, 1, 0); // EXIT

// Executes one program on one input; returns [output bytes, exit code].
// A trap ends the run with the trap's own code as the exit code and keeps
// whatever output was already written.
function run(prog, input) {
  const len = prog.length;
  const stack = new Int32Array(256);
  const calls = new Int32Array(64);
  const mem = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, csp = 0, olen = 0, ipos = 0, pc = 0, steps = 0;
  const finish = (code) => [out.subarray(0, olen), code];
  for (;;) {
    if (steps === 1000000) return finish(10); // step limit
    if (pc < 0 || pc >= len) return finish(9); // pc outside the program
    const op = prog[pc];
    if (!DEF[op]) return finish(5); // unknown opcode
    const imm = IMM[op];
    if (pc + imm >= len) return finish(9); // immediate runs past the end
    steps++;
    const next = pc + 1 + imm;
    if (sp < POP[op]) return finish(2); // stack underflow
    if (sp - POP[op] + PSH[op] > 256) return finish(3); // stack overflow
    pc = next;
    switch (op) {
      case 0x00: // HALT
        return finish(0);
      case 0x01: // PUSH8, sign-extended
        stack[sp++] = (prog[next - 1] << 24) >> 24;
        break;
      case 0x02: // PUSH32, little-endian
        stack[sp++] = prog[next - 4] | (prog[next - 3] << 8) | (prog[next - 2] << 16) | (prog[next - 1] << 24);
        break;
      case 0x03: // POP
        sp--;
        break;
      case 0x04: // DUP
        stack[sp] = stack[sp - 1];
        sp++;
        break;
      case 0x05: { // SWAP
        const t = stack[sp - 1];
        stack[sp - 1] = stack[sp - 2];
        stack[sp - 2] = t;
        break;
      }
      case 0x06: // OVER
        stack[sp] = stack[sp - 2];
        sp++;
        break;
      case 0x07: { // ROT: ( a b c -- b c a )
        const t = stack[sp - 3];
        stack[sp - 3] = stack[sp - 2];
        stack[sp - 2] = stack[sp - 1];
        stack[sp - 1] = t;
        break;
      }
      case 0x17: // NEG, wrapping
        stack[sp - 1] = -stack[sp - 1] | 0;
        break;
      case 0x1b: // NOT
        stack[sp - 1] = ~stack[sp - 1];
        break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = stack[sp - 1], a = stack[sp - 2];
        let r;
        if (op === 0x10) r = (a + b) | 0; // ADD
        else if (op === 0x11) r = (a - b) | 0; // SUB
        else if (op === 0x12) r = Math.imul(a, b); // MUL, low 32 bits of the exact product
        else if (op === 0x13) { // DIV, truncated toward zero
          if (b === 0) return finish(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 0x14) { // MOD, sign of the dividend
          if (b === 0) return finish(4);
          r = b === -1 ? 0 : a % b | 0;
        } else if (op === 0x15) { // DIVU
          if (b === 0) return finish(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) { // MODU
          if (b === 0) return finish(4);
          r = (a >>> 0) % (b >>> 0) | 0;
        } else if (op === 0x18) r = a & b; // AND
        else if (op === 0x19) r = a | b; // OR
        else if (op === 0x1a) r = a ^ b; // XOR
        else if (op === 0x1c) r = a << (b & 31); // SHL
        else if (op === 0x1d) r = a >> (b & 31); // SHR, arithmetic
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0; // SHRU, logical
        else if (op === 0x20) r = a === b ? 1 : 0; // EQ
        else if (op === 0x21) r = a < b ? 1 : 0; // LT, signed
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU, unsigned
        stack[sp - 2] = r;
        sp--;
        break;
      }
      case 0x30: case 0x31: case 0x32: { // JMP, JZ, JNZ: relative to the next instruction
        const rel = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
        let go = op === 0x30;
        if (!go) {
          const v = stack[--sp];
          go = op === 0x31 ? v === 0 : v !== 0;
        }
        if (go) pc = next + rel;
        break;
      }
      case 0x33: // CALL: the immediate is an absolute address
        if (csp === 64) return finish(7);
        calls[csp++] = next;
        pc = prog[next - 2] | (prog[next - 1] << 8);
        break;
      case 0x34: // RET
        if (csp === 0) return finish(8);
        pc = calls[--csp];
        break;
      case 0x40: { // LOAD
        const a = stack[sp - 1];
        if (a < 0 || a > 255) return finish(6);
        stack[sp - 1] = mem[a];
        break;
      }
      case 0x41: { // STORE: ( v addr -- )
        const a = stack[sp - 1];
        if (a < 0 || a > 255) return finish(6);
        mem[a] = stack[sp - 2];
        sp -= 2;
        break;
      }
      case 0x50: { // PRINT: decimal ASCII, no padding, no newline
        const s = String(stack[sp - 1]);
        if (olen + s.length > 65536) return finish(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[olen++] = s.charCodeAt(i);
        break;
      }
      case 0x51: // PUTC: one byte, the low 8 bits
        if (olen === 65536) return finish(11);
        out[olen++] = stack[--sp] & 255;
        break;
      case 0x52: // IN: -1 once the input is used up
        stack[sp++] = ipos < input.length ? input[ipos++] : -1;
        break;
      case 0x53: // EXIT: the low byte of the popped value
        return finish(stack[--sp] & 255);
    }
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  let prog;
  try {
    prog = readFileSync(join(IN_DIR, id, 'program.bin'));
  } catch {
    continue; // not an instance directory
  }
  const input = readFileSync(join(IN_DIR, id, 'input.bin'));
  const [out, code] = run(prog, input);
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'stdout.bin'), out);
  writeFileSync(join(OUT_DIR, id, 'exit.txt'), code + '\n');
}
