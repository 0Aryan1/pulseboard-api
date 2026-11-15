import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { AuthLayout } from "./AuthLayout.jsx";
import { credentialsReceived, selectIsAuthenticated } from "./authSlice.js";
import {
  useLoginMutation,
  useSignupMutation,
} from "../../services/endpoints/auth.api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Field.jsx";
import { useToast } from "../../hooks/useToast.js";

export default function SignupPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  const isAuthenticated = useSelector(selectIsAuthenticated);

  const [signup, { isLoading: isSigningUp }] = useSignupMutation();
  const [login, { isLoading: isLoggingIn }] = useLoginMutation();
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  if (isAuthenticated) return <Navigate to="/projects" replace />;

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();

    try {
      await signup(form).unwrap();
    } catch (error) {
      toast.error(error, "Could not create the account.");
      return;
    }

    // POST /auth/signup returns the user but no token, so sign in right after.
    // The account exists from here on: if this step fails, retrying signup
    // would only answer EMAIL_TAKEN, so send the user to sign in instead.
    try {
      const { token } = await login({
        email: form.email,
        password: form.password,
      }).unwrap();

      dispatch(credentialsReceived({ token }));
      toast.success("Account created. Welcome to PulseBoard.");
      navigate("/projects", { replace: true });
    } catch {
      toast.success("Account created. Please sign in.");
      navigate("/login", { replace: true, state: { email: form.email } });
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start organising work in a few seconds."
      footer={
        <>
          Already registered?{" "}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Name"
          required
          minLength={2}
          value={form.name}
          onChange={update("name")}
          placeholder="Ada Lovelace"
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={update("email")}
          placeholder="you@example.com"
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={form.password}
          onChange={update("password")}
          hint="At least 8 characters."
          placeholder="••••••••"
        />
        <Button
          type="submit"
          size="lg"
          loading={isSigningUp || isLoggingIn}
          className="w-full"
        >
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
