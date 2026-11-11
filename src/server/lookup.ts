import type { DetailKey, MediaType } from '../shared/title.ts'
import type { Lookup, LookupResult } from './ports.ts'
import { createOmdbClient } from './omdb.ts'

/** Routes by type: movie/show to OMDb, games have no lookup. */
export class RoutingLookup implements Lookup {
  private omdb: Lookup

  constructor(omdb: Lookup) {
    this.omdb = omdb
  }

  private route(type: MediaType): Lookup | null {
    if (type === 'movie' || type === 'show') return this.omdb
    return null
  }

  async search(type: MediaType, q: string): Promise<LookupResult[]> {
    return (await this.route(type)?.search(type, q)) ?? []
  }

  async details(type: MediaType, id: string): Promise<Partial<Record<DetailKey, string>>> {
    return (await this.route(type)?.details(type, id)) ?? {}
  }
}

/** The real lookup: OMDb key from OMDB_API_KEY, global fetch. */
export function createLookup(): Lookup {
  return new RoutingLookup(createOmdbClient())
}
