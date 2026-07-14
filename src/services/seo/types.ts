export type SeoPageType = 'home' | 'teacher' | 'course' | 'courses' | 'free-lecture' | 'blog';

export type TenantSeoRecord = {
  tenant_id: number;
  subdomain: string;
  display_name: string;
  specialty: string | null;
  bio: string | null;
  avatar_url: string | null;
  seo_title: string | null;
  seo_meta_description: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  seo_keywords: string[];
  canonical_url: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  twitter_title: string | null;
  twitter_description: string | null;
  twitter_image: string | null;
  robots_index: boolean;
  robots_follow: boolean;
  auto_generate: boolean;
};

export type PageSeoMetadata = {
  page: SeoPageType;
  path: string;
  canonicalUrl: string;
  title: string;
  description: string;
  keywords: string[];
  robots: { index: boolean; follow: boolean };
  openGraph: {
    title: string;
    description: string;
    url: string;
    type: string;
    image: string | null;
    siteName: string;
    locale: string;
  };
  twitter: {
    card: 'summary_large_image';
    title: string;
    description: string;
    image: string | null;
  };
  favicon: string | null;
  jsonLd: Record<string, unknown>[];
};

export type PublicTeacherPage = {
  tenant: {
    subdomain: string;
    display_name: string;
    specialty: string | null;
    bio: string | null;
    avatar_url: string | null;
    public_url: string;
  };
  teacher: {
    name: string;
    avatar: string | null;
    description: string | null;
    subject: string | null;
    facebook_url: string | null;
    instagram_url: string | null;
    youtube_url: string | null;
    tiktok_url: string | null;
    whatsapp_number: string | null;
  } | null;
  stats: {
    students_count: number;
    courses_count: number;
    grades_count: number;
  };
  ratings: {
    average: number | null;
    count: number;
  };
  grades: Array<{ id: number; name: string; slug: string | null; stage: string | null }>;
  subjects: string[];
  latest_courses: PublicCourseSummary[];
  social_links: Array<{ type: string; url: string }>;
};

export type PublicCourseSummary = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  price: number;
  is_free: boolean;
  avatar: string | null;
  grade: { id: number; name: string; slug: string | null } | null;
  students_count: number;
  rating_average: number | null;
  rating_count: number;
  created_at: string;
  public_url: string;
};

export type PublicCoursePage = {
  course: PublicCourseSummary & {
    seo_title: string | null;
    seo_description: string | null;
    seo_keywords: string[];
    teacher_name: string;
    teacher_avatar: string | null;
    view_count: number;
  };
  tenant: {
    subdomain: string;
    display_name: string;
    public_url: string;
  };
  breadcrumbs: Array<{ name: string; path: string }>;
};

export type SearchResultItem = {
  type: 'teacher' | 'course';
  id: number;
  title: string;
  subtitle: string | null;
  slug: string;
  subdomain?: string;
  avatar: string | null;
  specialty?: string | null;
  subject?: string | null;
  grade?: string | null;
  stage?: string | null;
  students_count: number;
  courses_count?: number;
  rating_average: number | null;
  view_count: number;
  public_url: string;
  score: number;
  updated_at: string | null;
};
