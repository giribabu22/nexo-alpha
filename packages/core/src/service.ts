export interface NexoService {
  readonly name: string;
  readonly description?: string;
  readonly purpose?: string;
  readonly dependencies?: readonly string[];
}
