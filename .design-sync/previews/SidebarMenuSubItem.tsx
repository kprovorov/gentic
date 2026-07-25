import * as React from "react"
import {
  Sidebar,
  SidebarContent,
  TooltipProvider,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@gentic/ui"
// NOTE: do NOT import from "@tabler/icons-react" in preview .tsx files —
// esbuild's targeted preview-rebuild enters runaway memory growth (observed
// 14GB+ RSS) when bundling named imports from that package here, even
// though the same imports are fine inside packages/ui/src itself (bundled
// via the main package-build.mjs entry, a different esbuild invocation).
// Use small inline SVGs instead. See .design-sync/NOTES.md.
function svgIcon(path: string) {
  return function Icon(props: React.SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={16}
        height={16}
        {...props}
      >
        <path d={path} />
      </svg>
    )
  }
}
const IconCirclePlus = svgIcon(
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 8v8M8 12h8"
)
const IconDots = svgIcon(
  "M5 12h.01M12 12h.01M19 12h.01M5 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0M12 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0M19 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0"
)
const IconFolder = svgIcon(
  "M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"
)
const IconHome = svgIcon("M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z")
const IconListDetails = svgIcon("M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01")
const IconLogout = svgIcon(
  "M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 17l5-5-5-5M21 12H9"
)
const IconSettings = svgIcon(
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
)

export function Default() {
  return (
    <div
      style={{
        height: 480,
        width: 560,
        position: "relative",
        contain: "layout",
        overflow: "hidden",
        borderRadius: 12,
        border: "1px solid var(--border)",
      }}
    >
      <TooltipProvider>
      <SidebarProvider defaultOpen style={{ height: "100%" }}>
        <Sidebar>
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  className="data-[slot=sidebar-menu-button]:p-1.5!"
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: "var(--primary)",
                      flexShrink: 0,
                    }}
                  />
                  <span className="font-heading text-base font-semibold">
                    Gentic
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarInput placeholder="Search issues..." />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      className="min-w-8 bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                    >
                      <a href="#">
                        <IconCirclePlus />
                        <span>New issue</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive tooltip="Home">
                      <a href="#">
                        <IconHome />
                        <span>Home</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Issues">
                      <a href="#">
                        <IconListDetails />
                        <span>Issues</span>
                      </a>
                    </SidebarMenuButton>
                    <SidebarMenuAction title="More options">
                      <IconDots />
                      <span className="sr-only">More options</span>
                    </SidebarMenuAction>
                    <SidebarMenuBadge>12</SidebarMenuBadge>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupAction title="Add project">
                <IconCirclePlus />
                <span className="sr-only">Add project</span>
              </SidebarGroupAction>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Projects">
                      <a href="#">
                        <IconFolder />
                        <span>Projects</span>
                      </a>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="#">
                          <span>Web app</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="#" isActive>
                          <span>Worker CLI</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Settings">
                      <a href="#">
                        <IconSettings />
                        <span>Settings</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg">
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "var(--muted)",
                      flexShrink: 0,
                    }}
                  />
                  <div
                    style={{
                      display: "grid",
                      textAlign: "left",
                      lineHeight: 1.2,
                    }}
                  >
                    <span className="truncate text-sm font-medium">
                      Kirill Provorov
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      kirill@provorov.dev
                    </span>
                  </div>
                  <IconLogout
                    style={{ marginLeft: "auto" }}
                    className="size-4 text-muted-foreground"
                  />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <SidebarTrigger />
            <span className="text-sm font-medium">Issues</span>
          </div>
          <div style={{ padding: 16 }}>
            <p className="text-sm text-muted-foreground" style={{ margin: 0 }}>
              Main content area rendered inside SidebarInset.
            </p>
          </div>
        </SidebarInset>
      </SidebarProvider>
      </TooltipProvider>
    </div>
  )
}

export function LoadingState() {
  return (
    <div
      style={{
        height: 380,
        width: 280,
        position: "relative",
        contain: "layout",
        overflow: "hidden",
        borderRadius: 12,
        border: "1px solid var(--border)",
      }}
    >
      <TooltipProvider>
      <SidebarProvider defaultOpen style={{ height: "100%" }}>
        <Sidebar>
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  className="data-[slot=sidebar-menu-button]:p-1.5!"
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: "var(--primary)",
                      flexShrink: 0,
                    }}
                  />
                  <span className="font-heading text-base font-semibold">
                    Gentic
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Loading</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <SidebarMenuItem key={index}>
                      <SidebarMenuSkeleton showIcon />
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>
      </TooltipProvider>
    </div>
  )
}
