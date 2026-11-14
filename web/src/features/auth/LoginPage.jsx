import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { AuthLayout } from "./AuthLayout.jsx";
import { credentialsReceived, selectIsAuthenticated } from "./authSlice.js";
import { useLoginMutation } from "../../services/endpoints/auth.api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Field.jsx";
import { useToast } from "../../hooks/useToast.js";

export default function LoginPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const isAuthenticated = useSelector(selectIsAuthenticated);

  const [login, { isLoading }] = useLoginMutation();
  // SignupPage passes the email along when the account was created but the
  // automatic sign-in failed.
  const [form, setForm] = useState({
    email: location.state?.email ?? "",
    password: "",
  });

  if (isAuthenticated) return <Navigate to="/projects" replace />;

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();

    try {
      const { token } = await login(form).unwrap();
      dispatch(credentialsReceived({ token }));
      navigate("/projects", { replace: true });
    } catch (error) {
      toast.error(error, "Could not sign in.");
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your PulseBoard workspace."
      footer={
        <>
          No account yet?{" "}
          <Link to="/signup" className="font-medium text-brand-700 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
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
          autoComplete="current-password"
          required
          minLength={8}
          value={form.password}
          onChange={update("password")}
          placeholder="••••••••"
        />
        <Button type="submit" size="lg" loading={isLoading} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
