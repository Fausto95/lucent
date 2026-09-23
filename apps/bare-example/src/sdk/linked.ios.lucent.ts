import { RCTAppDependencyProvider } from "lucent:ios/ReactAppDependencyProvider";

export async function linkedLibraries(): Promise<string> {
  const provider = new RCTAppDependencyProvider();
  return `${provider.urlRequestHandlerClassNames().length} request handlers, ${provider.imageDataDecoderClassNames().length} image decoders`;
}
