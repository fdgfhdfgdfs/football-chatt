import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://nxcamntxvzqantqshepp.supabase.co";
const supabaseKey = "sb_publishable_8bHAmWWvENW1bkha_G32Gg_oxO_G4pQ";

export const supabase = createClient(supabaseUrl, supabaseKey);
