"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { getStaffByUid, listenCurrentUser } from "@/lib/auth";
import type { StaffUser } from "@/lib/auth";

export function useCurrentUser() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = listenCurrentUser(async (user: User | null) => {
      if (!user) {
        setCurrentUser(null);
        setAuthReady(true);
        router.replace("/login");
        return;
      }

      const staff = await getStaffByUid(user.uid);

      if (!staff || !staff.active) {
        setCurrentUser(null);
        setAuthReady(true);
        router.replace("/login");
        return;
      }

      setCurrentUser(staff);
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, [router]);

  return { currentUser, authReady };
}
