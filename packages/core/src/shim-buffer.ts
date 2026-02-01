import { Buffer } from 'buffer';

// Make Buffer available globally for browser
if (typeof globalThis !== 'undefined') {
    (globalThis as any).Buffer = Buffer;
}
if (typeof window !== 'undefined') {
    (window as any).Buffer = Buffer;
}

export { Buffer };
