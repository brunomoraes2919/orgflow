/* OrgFlow — Supabase project. The "anon public" key is meant for the browser:
   the access rules in supabase/schema.sql are what protect the data.
   With both empty the app runs in local mode, without login. */
window.ORGFLOW_SUPABASE = {
  url: '',
  anonKey: '',
};
