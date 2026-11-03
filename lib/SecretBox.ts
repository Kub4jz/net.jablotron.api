import crypto from 'crypto';

/**
 * Symmetric encryption for secrets kept in Homey settings (AES-256-GCM).
 *
 * Encrypted values look like `enc:v1:<iv>:<tag>:<ciphertext>` (base64 parts),
 * so they can be recognised and validated before decrypting.
 */
export class SecretBox {
    static readonly PREFIX = 'enc:v1:';

    private static readonly ALGORITHM = 'aes-256-gcm';
    private static readonly KEY_LENGTH = 32;
    private static readonly IV_LENGTH = 12;

    private constructor(private readonly key: Buffer) {
    }

    /** Derive the key from a secret and a per-installation salt. */
    static create(secret: string, salt: Buffer): SecretBox {
        return new SecretBox(crypto.scryptSync(secret, salt, SecretBox.KEY_LENGTH));
    }

    static isEncrypted(value: unknown): value is string {
        return typeof value === 'string' && value.startsWith(SecretBox.PREFIX);
    }

    encrypt(plainText: string): string {
        const iv = crypto.randomBytes(SecretBox.IV_LENGTH);
        const cipher = crypto.createCipheriv(SecretBox.ALGORITHM, this.key, iv);
        const cipherText = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();

        return SecretBox.PREFIX + [iv, tag, cipherText].map(part => part.toString('base64')).join(':');
    }

    /** Throws if the value is malformed, tampered with or was encrypted with another key. */
    decrypt(value: string): string {
        if (!SecretBox.isEncrypted(value)) {
            throw new Error('Value is not encrypted.');
        }

        const parts = value.slice(SecretBox.PREFIX.length).split(':');
        if (parts.length !== 3) {
            throw new Error('Malformed encrypted value.');
        }

        const [iv, tag, cipherText] = parts.map(part => Buffer.from(part, 'base64'));
        const decipher = crypto.createDecipheriv(SecretBox.ALGORITHM, this.key, iv);
        decipher.setAuthTag(tag);

        return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
    }
}
