import { uuidv7 } from 'uuidv7';

/** Time-ordered UUIDv7 for every primary key (DATABASE.md §2). */
export function newId(): string {
  return uuidv7();
}
