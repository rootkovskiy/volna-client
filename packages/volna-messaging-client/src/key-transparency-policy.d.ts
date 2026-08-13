declare const policy: {
  status: 'pending_operator_registration' | 'active';
  mode: 'c2sp-map-v1';
  origin: string;
  logVkey: string | null;
  threshold: 2;
  maxAgeSeconds: number;
  witnessVkeys: [string, string, string];
  operators: Array<{ operator: string; endpoint: string }>;
};

export default policy;
