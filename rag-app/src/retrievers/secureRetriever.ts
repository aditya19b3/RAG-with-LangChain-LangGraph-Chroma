import { Chroma } from '@langchain/community/vectorstores/chroma';
import { Document } from '@langchain/core/documents';
import { getStore, ChromaStoreOptions } from '../vectorstore/chroma.js';

export interface UserSession {
  id: string;
  tenantId: string;
  roles: string[];
}

/**
 * Returns a retriever that is pre-filtered at the database level
 * to restrict chunks only to the user's tenantId and matching roles (ACL).
 */
export async function retrieverForUser(user: UserSession, k = 20, options: ChromaStoreOptions = {}) {
  const store = await getStore(options);

  // Enforce metadata criteria inside Chroma's 'where' clause
  const filter = {
    $and: [
      { tenant: { $eq: user.tenantId } },
      { acl: { $in: user.roles } },
    ],
  };

  return store.asRetriever({ k, filter: filter as any });
}

/**
 * A second-gate security check that filters documents post-retrieval
 * to ensure no chunk from another tenant or unauthorized role is leaked.
 */
export function enforceAcl(docs: Document[], user: UserSession): Document[] {
  return docs.filter(
    (d) =>
      d.metadata.tenant === user.tenantId &&
      (Array.isArray(d.metadata.acl) ? d.metadata.acl : [d.metadata.acl]).some((role: any) =>
        user.roles.includes(role)
      )
  );
}
