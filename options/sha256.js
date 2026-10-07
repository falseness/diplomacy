// Small bundled SHA-256 (FIPS 180-4) for the state hash (options/actionRecorder.js): the same code
// runs in the browser, in node and in vm contexts without TextEncoder or crypto.
//
//   sha256Hex(string) -> 64 lowercase hex digits of the sha256 of the string's UTF-8 bytes

const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]

// UTF-8 bytes of a string, padded to whole 64-byte blocks with the 0x80 marker and the bit length.
function sha256PaddedUtf8(string) {
    // At most 3 bytes per UTF-16 unit (a 4-byte code point takes 2 units), plus 72 bytes of padding.
    let bytes = new Uint8Array(string.length * 3 + 72)
    let n = 0
    for (let i = 0; i < string.length; ++i) {
        let code = string.charCodeAt(i)
        if (code < 0x80) {
            bytes[n++] = code
            continue
        }
        // A surrogate pair is one code point; a lone surrogate is encoded as U+FFFD (as TextEncoder does).
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < string.length) {
            let low = string.charCodeAt(i + 1)
            if (low >= 0xdc00 && low <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
                ++i
            }
        }
        if (code >= 0xd800 && code <= 0xdfff)
            code = 0xfffd
        if (code < 0x800) {
            bytes[n++] = 0xc0 | (code >> 6)
            bytes[n++] = 0x80 | (code & 0x3f)
        } else if (code < 0x10000) {
            bytes[n++] = 0xe0 | (code >> 12)
            bytes[n++] = 0x80 | ((code >> 6) & 0x3f)
            bytes[n++] = 0x80 | (code & 0x3f)
        } else {
            bytes[n++] = 0xf0 | (code >> 18)
            bytes[n++] = 0x80 | ((code >> 12) & 0x3f)
            bytes[n++] = 0x80 | ((code >> 6) & 0x3f)
            bytes[n++] = 0x80 | (code & 0x3f)
        }
    }
    let bitLength = n * 8
    bytes[n++] = 0x80
    while (n % 64 != 56)
        bytes[n++] = 0
    let high = Math.floor(bitLength / 0x100000000)
    let low = bitLength >>> 0
    bytes[n++] = (high >>> 24) & 0xff
    bytes[n++] = (high >>> 16) & 0xff
    bytes[n++] = (high >>> 8) & 0xff
    bytes[n++] = high & 0xff
    bytes[n++] = (low >>> 24) & 0xff
    bytes[n++] = (low >>> 16) & 0xff
    bytes[n++] = (low >>> 8) & 0xff
    bytes[n++] = low & 0xff
    return bytes.subarray(0, n)
}

function sha256Hex(string) {
    let bytes = sha256PaddedUtf8(String(string))
    let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    let w = new Int32Array(64)
    for (let offset = 0; offset < bytes.length; offset += 64) {
        for (let i = 0; i < 16; ++i) {
            let j = offset + i * 4
            w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]
        }
        for (let i = 16; i < 64; ++i) {
            let a = w[i - 15], b = w[i - 2]
            let s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
            let s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
        }
        let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]
        for (let i = 0; i < 64; ++i) {
            let S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
            let ch = (e & f) ^ (~e & g)
            let t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) | 0
            let S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
            let maj = (a & b) ^ (a & c) ^ (b & c)
            let t2 = (S0 + maj) | 0
            hh = g
            g = f
            f = e
            e = (d + t1) | 0
            d = c
            c = b
            b = a
            a = (t1 + t2) | 0
        }
        h = [(h[0] + a) | 0, (h[1] + b) | 0, (h[2] + c) | 0, (h[3] + d) | 0,
            (h[4] + e) | 0, (h[5] + f) | 0, (h[6] + g) | 0, (h[7] + hh) | 0]
    }
    let hex = ''
    for (let i = 0; i < 8; ++i)
        hex += (h[i] >>> 0).toString(16).padStart(8, '0')
    return hex
}
