import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// -------------------------------------------------------------------
// Entity name → Supabase table name map
// Mirrors the Base44 entity definitions exactly.
// -------------------------------------------------------------------
const ENTITY_TABLE_MAP = {
  Activity:           'activities',
  ActivityScore:      'activity_scores',
  Announcement:       'announcements',
  Attendance:         'attendances',
  Badge:              'badges',
  BadgeDefinition:    'badge_definitions',
  ActivityEvidence:   'activity_evidence',
  Classroom:          'classrooms',
  ClassSettings:      'class_settings',
  GradingTerm:        'grading_terms',
  Group:              'groups',
  GroupAccount:       'group_accounts',
  GroupMember:        'group_members',
  Mission:            'missions',
  MissionSubmission:  'mission_submissions',
  ParticipationLog:   'participation_logs',
  QRCode:             'qr_codes',
  Reward:             'rewards',
  RewardRedemption:   'reward_redemptions',
  LearningReview:     'learning_reviews',
  TeacherAssessment:  'teacher_assessments',
  User:               'profiles',
};

// Most panels request the same classroom data more than once during navigation
// (the header switcher and the page body are a common example). Keep a small
// browser-local cache and share in-flight requests to make those transitions
// feel instant while still invalidating immediately after writes.
const READ_CACHE_TTL = 15 * 1000;
const readCache = new Map();

function clearReadCache(tableName) {
  if (!tableName) {
    readCache.clear();
    return;
  }
  for (const key of readCache.keys()) {
    if (key.startsWith(`${tableName}:`)) readCache.delete(key);
  }
}

function readCacheKey(tableName, conditions, options) {
  return `${tableName}:${JSON.stringify({ conditions, options })}`;
}

supabase.auth.onAuthStateChange(() => clearReadCache());

// -------------------------------------------------------------------
// Generic entity helper — mirrors the Base44 SDK CRUD surface exactly:
//   .filter(conditions)  .get(id)  .create(payload)
//   .update(id, payload) .delete(id)
//   .bulkCreate(items)   .bulkUpdate(items)
// -------------------------------------------------------------------
function createEntityHelper(tableName) {
  return {
    /** Return all rows matching all conditions (AND equality). */
    async filter(conditions = {}, options = {}) {
      const key = readCacheKey(tableName, conditions, options);
      const cached = readCache.get(key);
      if (cached && Date.now() - cached.createdAt < READ_CACHE_TTL) {
        return cached.promise.then((rows) => rows.slice());
      }

      const columns = options.columns || '*';
      let q = supabase.from(tableName).select(columns);
      for (const [key, value] of Object.entries(conditions)) {
        q = q.eq(key, value);
      }
      if (options.orderBy) q = q.order(options.orderBy, { ascending: options.ascending !== false });
      if (options.limit != null) q = q.limit(options.limit);
      if (options.offset != null) q = q.range(options.offset, options.offset + (options.limit || 50) - 1);
      const promise = q.then(({ data, error }) => {
        if (error) throw error;
        return data ?? [];
      });
      readCache.set(key, { createdAt: Date.now(), promise });
      promise.catch(() => {
        if (readCache.get(key)?.promise === promise) readCache.delete(key);
      });
      return promise.then((rows) => rows.slice());
    },

    /** Paginated variant for high-volume classroom data. */
    async page(conditions = {}, options = {}) {
      const limit = Math.max(1, Math.min(options.limit || 50, 500));
      const offset = Math.max(0, options.offset || 0);
      const rows = await this.filter(conditions, { ...options, limit, offset });
      return { rows, limit, offset, hasMore: rows.length === limit };
    },

    /** Return a single row by primary key. */
    async get(id) {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },

    /** Insert a new row and return it. */
    async create(payload) {
      const { data, error } = await supabase
        .from(tableName)
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      clearReadCache(tableName);
      return data;
    },

    /** Update a row by id and return the updated row. */
    async update(id, payload) {
      const { data, error } = await supabase
        .from(tableName)
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      clearReadCache(tableName);
      return data;
    },

    /** Delete a row by id. */
    async delete(id) {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', id);
      if (error) throw error;
      clearReadCache(tableName);
    },

    /** Insert multiple rows and return them. */
    async bulkCreate(items) {
      if (!items?.length) return [];
      const { data, error } = await supabase
        .from(tableName)
        .insert(items)
        .select();
      if (error) throw error;
      clearReadCache(tableName);
      return data ?? [];
    },

    /**
     * Update multiple rows.
     * Each item must have an `id` field; the rest are the patch payload.
     * Runs in parallel — same semantics as Base44 bulkUpdate.
     */
    async bulkUpdate(items) {
      if (!items?.length) return [];
      const results = await Promise.all(
        items.map(({ id, ...payload }) =>
          supabase
            .from(tableName)
            .update(payload)
            .eq('id', id)
            .select()
            .single()
        )
      );
      const firstError = results.find((r) => r.error);
      if (firstError) throw firstError.error;
      clearReadCache(tableName);
      return results.map((r) => r.data);
    },

    /**
     * Live-update subscription — mirrors the Base44 SDK's `.subscribe(cb)`.
     * Calls `callback` on every insert/update/delete for this table via
     * Supabase Realtime. Returns an unsubscribe function.
     *
     * Requires the table to be added to the `supabase_realtime` publication:
     *   alter publication supabase_realtime add table <table_name>;
     * (see SUPABASE_MIGRATION.md, Step 3b).
     */
    subscribe(callback) {
      const channelName = `${tableName}-changes-${Math.random().toString(36).slice(2)}`;
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: tableName },
          (payload) => callback(payload)
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    },
  };
}

// -------------------------------------------------------------------
// Auth wrapper — mirrors the Base44 auth surface used across the app:
//   me()  logout()  redirectToLogin()  updateMe()
// Login / register / password-reset calls are handled directly
// by the auth pages using the `supabase` export.
// -------------------------------------------------------------------
const auth = {
  /** Return the current authenticated user (merged with profile row). */
  async me() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw error ?? new Error('Not authenticated');

    // Merge auth user with profile metadata stored in user_metadata
    return {
      id: user.id,
      email: user.email,
      role: user.user_metadata?.role ?? 'user',
      ...user.user_metadata,
    };
  },

  /** Sign out and optionally redirect. */
  async logout(redirectUrl) {
    await supabase.auth.signOut();
    if (redirectUrl) {
      window.location.href = redirectUrl;
    } else {
      window.location.href = '/login';
    }
  },

  /** Navigate to the login page. */
  redirectToLogin(returnUrl) {
    const target = returnUrl
      ? `/login?returnUrl=${encodeURIComponent(returnUrl)}`
      : '/login';
    window.location.href = target;
  },

  /**
   * Update the current user's metadata (mirrors the Base44 SDK's
   * `auth.updateMe(data)`). In Supabase this maps to
   * `supabase.auth.updateUser({ data })`.
   */
  async updateMe(data) {
    const { data: { user }, error } = await supabase.auth.updateUser({ data });
    if (error) throw error;
    return {
      id: user.id,
      email: user.email,
      role: user.user_metadata?.role ?? 'user',
      ...user.user_metadata,
    };
  },
};

// -------------------------------------------------------------------
// Entities proxy — dynamically creates helpers on first access so all
// existing pages using `db.entities.Classroom.filter(...)` etc. work
// without any changes.
// -------------------------------------------------------------------
const entities = new Proxy(
  {},
  {
    get(_, entityName) {
      const tableName = ENTITY_TABLE_MAP[entityName];
      if (!tableName) {
        throw new Error(`[supabaseClient] Unknown entity: "${entityName}". Add it to ENTITY_TABLE_MAP.`);
      }
      return createEntityHelper(tableName);
    },
  }
);

// -------------------------------------------------------------------
// The `db` object is a drop-in replacement for the Base44 SDK client.
// All existing pages that do:
//   const db = globalThis.__B44_DB__;
//   db.entities.Classroom.filter(...)
// continue to work unchanged.
// -------------------------------------------------------------------
export const db = { entities, auth };

export function invalidateEntityCache(entityName) {
  const tableName = ENTITY_TABLE_MAP[entityName];
  if (tableName) clearReadCache(tableName);
}

// Make available globally so all pages using the pattern
// `const db = globalThis.__B44_DB__` resolve correctly.
globalThis.__B44_DB__ = db;
