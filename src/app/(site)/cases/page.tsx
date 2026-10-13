import { redirect } from "next/navigation";

// Kundcase listas tillsammans med egna produkter under /projects.
export default function Page() {
  redirect("/projects#cases");
}
