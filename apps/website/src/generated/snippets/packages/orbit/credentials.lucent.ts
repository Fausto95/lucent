import { PLATFORM } from "lucent:platform";
import { appContext } from "lucent:android";
import {
  CreatePasswordRequest,
  CredentialManager,
  GetCredentialRequest,
  GetPasswordOption,
  PasswordCredential,
} from "lucent:android/androidx.credentials";
import { delay, errorCode } from "lucent:core";

const NONE = "no Credential Manager on iOS";

/** Requests and credentials with Kotlin's defaults, read back as Jetpack documents them. */
export async function credentialRequests(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const option = new GetPasswordOption();
    const request = new GetCredentialRequest([option]);
    const options = request.credentialOptions;
    const credential = new PasswordCredential("ada", "secret");
    const create = new CreatePasswordRequest("ada", "secret");

    return [
      options.length,
      options[0] instanceof GetPasswordOption,
      option.type === PasswordCredential.TYPE_PASSWORD_CREDENTIAL,
      option.isAutoSelectAllowed(),
      option.allowedUserIds.isEmpty(),
      String(request.origin),
      credential instanceof PasswordCredential,
      credential.id,
      create.id,
      create.type === credential.type,
    ].join(" ");
  }
}

/**
 * A password lookup: the system answers with a credential, or a
 * GetCredentialException subclass (no credential saved, no provider); a
 * lookup still waiting for the user after 5 s is cancelled.
 */
export async function credentialLookup(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const manager = CredentialManager.create(appContext());
    const controller = new AbortController();
    const timeout = (async () => {
      await delay(5000, controller.signal);
      controller.abort();
    })();
    try {
      const response = await manager.getCredential!(
        appContext(),
        new GetCredentialRequest([new GetPasswordOption()]),
        controller.signal,
      );
      return response.credential instanceof PasswordCredential
        ? "a password credential"
        : "another credential";
    } catch (e) {
      const code = errorCode(e as Error) ?? "";
      if (code.startsWith("androidx.credentials.exceptions.")) return "a GetCredentialException";
      return (e as Error).name === "AbortError" ? "cancelled while waiting" : code;
    } finally {
      controller.abort();
      try {
        await timeout;
      } catch {
        // The timer, cancelled.
      }
    }
  }
}
