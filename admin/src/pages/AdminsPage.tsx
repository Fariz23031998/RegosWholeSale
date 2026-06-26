import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAdmin, fetchAdmins, updateAdmin } from "@/lib/platform-api";
import { usePlatformAuth } from "@/store/platform-auth";

export function AdminsPage() {
  const token = usePlatformAuth((s) => s.accessToken)!;
  const currentId = usePlatformAuth((s) => s.admin?.id);
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", display_name: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["admins"],
    queryFn: () => fetchAdmins(token),
  });

  const createMutation = useMutation({
    mutationFn: () => createAdmin(token, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admins"] });
      setShowCreate(false);
      setForm({ email: "", password: "", display_name: "" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => updateAdmin(token, id, { is_active: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admins"] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Platform admins</h1>
          <p className="mt-1 text-sm text-slate-500">Users who can access this admin panel</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {showCreate ? "Cancel" : "Add admin"}
        </button>
      </div>

      {showCreate && (
        <form
          className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Display name"
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            required
          />
          <input
            type="email"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            type="password"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {createMutation.isPending ? "Creating…" : "Create admin"}
          </button>
        </form>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={4}>
                  Loading…
                </td>
              </tr>
            ) : (
              data?.map((admin) => (
                <tr key={admin.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{admin.display_name}</td>
                  <td className="px-4 py-3 text-slate-600">{admin.email}</td>
                  <td className="px-4 py-3">
                    {admin.is_active ? (
                      <span className="text-emerald-700">Active</span>
                    ) : (
                      <span className="text-slate-500">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {admin.is_active && admin.id !== currentId && (
                      <button
                        type="button"
                        onClick={() => deactivateMutation.mutate(admin.id)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
