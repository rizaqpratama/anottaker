import * as Crypto from 'expo-crypto'
import { setIdGenerator } from '@nertator/shared'

// Hermes has no crypto.randomUUID(); expo-crypto's is synchronous and matches the
// Web Crypto signature. Imported once for its side effect before anything else in
// the app calls @nertator/shared's uid().
setIdGenerator(() => Crypto.randomUUID())
