// supabase/migrations/0001_initial_schema.sql に対応する型。
// マイグレーションを変更したらこのファイルも合わせて更新する。

export type DayCategory = "weekday" | "friday" | "saturday" | "sunday_holiday";
export type StaffRole = "admin" | "staff";
export type AssignmentStatus = "draft" | "confirmed";

export type Database = {
  public: {
    Tables: {
      staff: {
        Row: {
          id: string;
          name: string;
          role: StaffRole;
          display_order: number;
          password_hash: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          role?: StaffRole;
          display_order?: number;
          password_hash?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          role?: StaffRole;
          display_order?: number;
          password_hash?: string | null;
          created_at?: string;
        };
      };
      shift_frames: {
        Row: {
          id: string;
          name: string;
          start_time: string;
          end_time: string;
          color: string;
          display_order: number;
        };
        Insert: {
          id?: string;
          name: string;
          start_time: string;
          end_time: string;
          color?: string;
          display_order?: number;
        };
        Update: {
          id?: string;
          name?: string;
          start_time?: string;
          end_time?: string;
          color?: string;
          display_order?: number;
        };
      };
      required_counts: {
        Row: {
          id: string;
          shift_frame_id: string;
          day_category: DayCategory;
          count: number;
        };
        Insert: {
          id?: string;
          shift_frame_id: string;
          day_category: DayCategory;
          count: number;
        };
        Update: {
          id?: string;
          shift_frame_id?: string;
          day_category?: DayCategory;
          count?: number;
        };
      };
      shift_requests: {
        Row: {
          id: string;
          staff_id: string;
          date: string;
          shift_frame_id: string;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          staff_id: string;
          date: string;
          shift_frame_id: string;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          staff_id?: string;
          date?: string;
          shift_frame_id?: string;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      shift_assignments: {
        Row: {
          id: string;
          staff_id: string;
          date: string;
          shift_frame_id: string | null;
          status: AssignmentStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          staff_id: string;
          date: string;
          shift_frame_id?: string | null;
          status?: AssignmentStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          staff_id?: string;
          date?: string;
          shift_frame_id?: string | null;
          status?: AssignmentStatus;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
};
