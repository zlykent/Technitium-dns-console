import { Suspense } from 'react'
import { LoginForm } from '@/components/auth/login-form'
import { Spinner } from '@/components/ui/spinner'

/**
 * `/login`.
 *
 * `useSearchParams` inside the form (it reads `?next=`) requires a Suspense
 * boundary in a statically-rendered page, otherwise the whole route opts into
 * dynamic rendering at build time.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner className="size-5" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
