export type DecryptedEventRecord = {
  envelopeId: string;
  senderAccountId: string;
  senderDeviceId: string;
  serverCreatedAt: string;
  event: unknown;
};

export type ProjectedMessage = {
  id: string;
  senderAccountId: string;
  senderDeviceId: string;
  text?: string;
  attachment?: unknown;
  clientCreatedAt: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  reactions: Array<{ accountId: string; emoji: string }>;
};

export declare class MessageProjectionError extends Error {
  readonly code: string;
}

export declare function projectContentEvents(records: DecryptedEventRecord[]): ProjectedMessage[];

export declare class MessageProjection {
  constructor(records?: DecryptedEventRecord[]);
  append(record: DecryptedEventRecord): boolean;
  snapshot(): ProjectedMessage[];
  exportRecords(): DecryptedEventRecord[];
}
