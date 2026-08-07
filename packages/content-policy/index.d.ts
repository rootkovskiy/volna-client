export type ProfileTextViolation = 'link' | 'profanity';

export declare function containsDisallowedLink(value: unknown): boolean;
export declare function containsRussianProfanity(value: unknown): boolean;
export declare function getProfileTextViolation(value: unknown): ProfileTextViolation | null;
