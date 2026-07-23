export abstract class ApiToEngineClient {
  abstract startSession(sessionId: string, projectId: string): Promise<void>;
}
