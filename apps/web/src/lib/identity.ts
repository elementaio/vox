import { Vault, createIdentity, restoreIdentity } from "@pochta-chat/sdk";
import type { Identity } from "@pochta-chat/sdk";

/**
 * Browser binding for the SDK identity/vault. The pure crypto lives in
 * @pochta-chat/sdk; here we back the account vault + device id with the
 * browser's `localStorage`. (A desktop/mobile app would back it with the OS
 * keychain instead — same SDK, different KVStore.)
 */
const vault = new Vault(localStorage);

export const hasIdentity = (): boolean => vault.has();
export const clearIdentity = (): void => vault.clear();
export const persistIdentity = (id: Identity, passphrase: string): Promise<void> =>
  vault.persist(id, passphrase);
export const unlockIdentity = (passphrase: string): Promise<Identity | null> =>
  vault.unlock(passphrase);
export const deviceId = (): string => vault.deviceId();

export { createIdentity, restoreIdentity };
export type { Identity };
