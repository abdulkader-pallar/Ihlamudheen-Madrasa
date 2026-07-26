export interface User {
  id: string
  name: string | null
  email: string | null
  role: 'student' | 'instructor' | 'admin'
  avatar_url: string | null
  created_at: string
}

export interface Course {
  id: string
  title: string
  description: string | null
  instructor_id: string | null
  thumbnail: string | null
  price: number
  category: string | null
  created_at: string
}

export interface Enrollment {
  id: string
  user_id: string
  course_id: string
  progress: number
  enrolled_at: string
}

export interface Lesson {
  id: string
  course_id: string
  title: string
  video_url: string | null
  duration: number | null
  order_index: number | null
  created_at: string
}

export interface Announcement {
  id: string
  title: string
  message: string | null
  created_at: string
}

export interface Database {
  public: {
    Tables: {
      users: {
        Row: User
        Insert: Omit<User, 'created_at'> & { created_at?: string }
        Update: Partial<Omit<User, 'id'>>
      }
      courses: {
        Row: Course
        Insert: Omit<Course, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Course, 'id'>>
      }
      enrollments: {
        Row: Enrollment
        Insert: Omit<Enrollment, 'id' | 'enrolled_at' | 'progress'> & {
          id?: string
          enrolled_at?: string
          progress?: number
        }
        Update: Partial<Omit<Enrollment, 'id'>>
      }
      lessons: {
        Row: Lesson
        Insert: Omit<Lesson, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Lesson, 'id'>>
      }
      announcements: {
        Row: Announcement
        Insert: Omit<Announcement, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Announcement, 'id'>>
      }
    }
  }
}
