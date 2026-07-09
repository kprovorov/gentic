"use client"

import Link from "next/link"
import { IconFolder, IconListDetails } from "@tabler/icons-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@gentic/ui/sidebar"

import { Logo } from "./logo"
import { NavMain } from "./nav-main"
import { NavUser } from "./nav-user"

const navMain = [
  { title: "Issues", href: "/home", icon: IconListDetails },
  { title: "Projects", href: "/settings", icon: IconFolder },
]

export function AppSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <Link href="/home">
                <Logo className="size-5" />
                <span className="font-heading text-base font-semibold">
                  Gentic
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
