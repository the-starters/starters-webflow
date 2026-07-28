import * as React from 'react'
import { cn } from './lib'
import * as styles from './TalentApplicationsAdmin.module.css'

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost'
type ButtonSize = 'default' | 'small' | 'icon'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'default', ...props }, ref) => {
    const variantClass = {
      primary: styles.buttonPrimary,
      secondary: styles.buttonSecondary,
      destructive: styles.buttonDestructive,
      ghost: styles.buttonGhost,
    }[variant]
    const sizeClass = {
      default: styles.buttonDefault,
      small: styles.buttonSmall,
      icon: styles.buttonIcon,
    }[size]
    return (
      <button ref={ref} className={cn(styles.button, variantClass, sizeClass, className)} {...props} />
    )
  },
)
Button.displayName = 'Button'

export function Badge({
  children,
  tone,
}: {
  children: React.ReactNode
  tone?: string
}) {
  const toneClass: Record<string, string> = {
    submitted: styles.submitted,
    under_review: styles.under_review,
    interview_sent: styles.interview_sent,
    interview_completed: styles.interview_completed,
    approved: styles.approved,
    rejected: styles.rejected,
    on_hold: styles.on_hold,
    withdrawn: styles.withdrawn,
  }
  return <span className={cn(styles.badge, tone && toneClass[tone])}>{children}</span>
}

export function Card({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn(styles.card, className)}>{children}</div>
}
