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
        Relationships: [];
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
        Relationships: [];
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
        Relationships: [
          {
            foreignKeyName: "required_counts_shift_frame_id_fkey";
            columns: ["shift_frame_id"];
            isOneToOne: false;
            referencedRelation: "shift_frames";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "shift_requests_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_requests_shift_frame_id_fkey";
            columns: ["shift_frame_id"];
            isOneToOne: false;
            referencedRelation: "shift_frames";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "shift_assignments_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_assignments_shift_frame_id_fkey";
            columns: ["shift_frame_id"];
            isOneToOne: false;
            referencedRelation: "shift_frames";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
