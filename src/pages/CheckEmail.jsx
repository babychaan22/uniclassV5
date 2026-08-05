import React from "react";
import { Link } from "react-router-dom";
import { Mail, ArrowLeft } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function CheckEmail() {
  return (
    <AuthLayout
      icon={Mail}
      title="Check your email"
      subtitle="We sent a confirmation link"
      footer={
        <Link to="/login" className="text-primary font-medium hover:underline">
          <ArrowLeft className="w-3 h-3 inline mr-1" />Back to log in
        </Link>
      }
    >
      <div className="text-center space-y-4">
        <p className="text-sm text-ink/60">
          We sent a confirmation email to your address. Click the link in the email
          to activate your account.
        </p>
        <p className="text-sm text-ink/60">
          Didn't receive it? Check your Spam or Promotions folder.
        </p>
      </div>
    </AuthLayout>
  );
}