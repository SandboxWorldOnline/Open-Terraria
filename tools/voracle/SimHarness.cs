// BJ717-A vanilla physics oracle harness — drives the REAL TerrariaServer.exe 1.4.5.8
// engine headlessly (dedServ path, netMode=2, fake player slot 0, scripted controls)
// and records per-tick movement state. Referenced anchors: Main.DedServ (:5319-5911
// server loop = Initialize + serverLoadWorld + 60Hz Main.Update), MessageBuffer msg13
// (server-side player physics runs from last-reported controls).
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using Microsoft.Xna.Framework;
using Terraria;
using Terraria.ID;
using Terraria.IO;
using Terraria.Localization;
using Terraria.Social;
using VMain = Terraria.Main;

namespace SimHarness
{
    internal static class Program
    {
        static Main game;
        static Player p;
        static MethodInfo miInitialize, miUpdate;
        static StringBuilder tsv = new StringBuilder();
        static int tickCounter;

        static Assembly ResolveEmbedded(object sender, ResolveEventArgs e)
        {
            // Mirror Terraria's MacLaunch.AssemblyResolve: libraries are embedded
            // manifest resources of TerrariaServer.exe.
            try
            {
                string want = new AssemblyName(e.Name).Name + ".dll";
                Assembly terraria = typeof(Terraria.Program).Assembly;
                string found = null;
                foreach (string rn in terraria.GetManifestResourceNames())
                    if (rn.EndsWith(want)) { found = rn; break; }
                if (found == null) return null;
                using (Stream s = terraria.GetManifestResourceStream(found))
                {
                    byte[] buf = new byte[s.Length];
                    s.Read(buf, 0, buf.Length);
                    Console.WriteLine("[resolve] " + e.Name + " <- " + found);
                    return Assembly.Load(buf);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("[resolve-fail] " + e.Name + ": " + ex.Message);
                return null;
            }
        }

        // Ground/surface helpers
        static int groundRow; static int flatCx;
        static Vector2 groundPos; // player position (top-left) resting on flat floor

        static void Flatten(string tag)
        {
            int cx = flatCx;
            int surf = -1;
            for (int y = 8; y < VMain.maxTilesY - 60; y++)
            {
                if (VMain.tile[cx, y].active() && VMain.tileSolid[VMain.tile[cx, y].type]) { surf = y; break; }
            }
            if (surf < 0) surf = (int)VMain.worldSurface + 20;
            groundRow = surf;
            for (int x = cx - 30; x <= cx + 30; x++)
            {
                for (int y = surf - 60; y < surf; y++)
                {
                    VMain.tile[x, y].ClearTile();
                    VMain.tile[x, y].liquid = 0;
                }
                for (int y = surf; y < surf + 6; y++)
                {
                    VMain.tile[x, y].ClearTile();
                    VMain.tile[x, y].type = 0;
                    VMain.tile[x, y].active(true);
                    VMain.tile[x, y].liquid = 0;
                }
                for (int y = surf - 60; y < surf; y++)
                {
                    VMain.tile[x, y].wall = 0;
                }
            }
            groundPos = new Vector2(cx * 16f + 8f, surf * 16f - 42f);
            Console.WriteLine("[" + tag + "] flat spot col=" + cx + " groundRow=" + surf
                + " worldSurface=" + VMain.worldSurface + " maxTilesY=" + VMain.maxTilesY
                + " groundPos=" + groundPos);
        }

        static void FillBasin()
        {
            // water basin 12 wide, 9 deep right below the flat floor (for merman scenario)
            int cx = flatCx; int surf = groundRow;
            for (int x = cx - 6; x <= cx + 6; x++)
            {
                for (int y = surf + 6; y < surf + 52; y++)
                {
                    VMain.tile[x, y].ClearTile();
                    VMain.tile[x, y].wall = 0;
                    if (y < surf + 51) { VMain.tile[x, y].liquid = 255; VMain.tile[x, y].liquidType(0); }
                }
            }
            Console.WriteLine("basin filled at rows " + (surf + 6) + ".." + (surf + 50));
        }

        static void ClearNpcs()
        {
            for (int i = 0; i < 200; i++) { if (VMain.npc[i] != null && VMain.npc[i].active) VMain.npc[i].active = false; }
        }

        static void Tick()
        {
            ClearNpcs();
            miUpdate.Invoke(game, new object[] { new GameTime() });
            ClearNpcs();
            tickCounter++;
        }

        static void Rec(string scen, int t, string note)
        {
            tsv.AppendLine(string.Join("\t", new object[] {
                scen, t,
                p.position.X.ToString("F4"), p.position.Y.ToString("F4"),
                p.velocity.X.ToString("F4"), p.velocity.Y.ToString("F4"),
                p.jump, Terraria.Player.jumpHeight, Terraria.Player.jumpSpeed.ToString("F4"), p.gravity.ToString("F4"),
                p.maxFallSpeed.ToString("F4"),
                p.maxRunSpeed.ToString("F4"), p.runAcceleration.ToString("F4"), p.runSlowdown.ToString("F4"),
                p.accRunSpeed.ToString("F4"),
                p.carpetFrame, p.rocketTime, p.rocketDelay, p.rocketDelay2, p.wingTime.ToString("F2"),
                p.stealth.ToString("F4"), p.wet, p.merman, p.swimTime, p.mount.Type,
                p.controlJump ? 1 : 0, p.controlDown ? 1 : 0, p.controlRight ? 1 : 0,
                note
            }));
        }

        static void NoInput()
        {
            p.controlJump = false; p.controlLeft = false; p.controlRight = false;
            p.controlDown = false; p.controlUp = false; p.controlDash = false;
            p.controlUseItem = false; p.controlUseTile = false;
        }

        static void ResetToGround()
        {
            NoInput();
            p.mount.Dismount(p);
            p.velocity = Vector2.Zero;
            p.position = groundPos;
            p.jump = 0;
            p.wet = false; p.merman = false; p.swimTime = 0;
            p.isPerformingJump_DownDash = false;
            p.rocketDelay = 0; p.rocketDelay2 = 0;
        }

        static void Settle(int n, string scen)
        {
            for (int i = 0; i < n; i++)
            {
                NoInput();
                Tick();
                if (i == 0 || i == n - 1) Rec(scen, i, "settle");
            }
        }

        static Item Give(int itemId)
        {
            Item it = new Item();
            it.SetDefaults(itemId);
            return it;
        }

        static void ClearEquip()
        {
            for (int i = 0; i < p.armor.Length; i++) p.armor[i] = new Item();
            for (int i = 0; i < p.dye.Length; i++) p.dye[i] = new Item();
            for (int i = 0; i < p.miscEquips.Length; i++) p.miscEquips[i] = new Item();
            for (int i = 0; i < 10; i++) p.inventory[i] = new Item();
            p.selectedItemState.Select(0);
        }

        static int Main(string[] args)
        {
            Stage1();
            return Run(args);
        }

        // Mono JIT runs Terraria.Main's static ctor eagerly at first method that
        // references it; Program.SavePath must be set from a Terraria.Main-free
        // method first (Main..cctor: Path.Combine(Program.SavePath, "Worlds")).
        static void Stage1()
        {
            Terraria.Program.SavePath = "/tmp/bj717-oracle/saves";
            System.IO.Directory.CreateDirectory("/tmp/bj717-oracle/saves");
        }

        static int Run(string[] args)
        {
            string worldPath = args.Length > 0 ? args[0] : "sw-rig.wld";
            string outPath = args.Length > 1 ? args[1] : "sim-out.tsv";

            try
            {
            Console.WriteLine("[dbg] start");
            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;
            VMain.dedServ = true;      // BEFORE ctor: Main..ctor gates graphics init on !dedServ
            VMain.showSplash = false;

            // Mirror Program.RunGame prologue + Main.DedServ server bootstrap (:5319+),
            // minus the interactive menu / Netplay sockets / wall-clock pacing.
            LanguageManager.Instance.SetLanguage(GameCulture.DefaultCulture);
            game = new Main();
            Lang.InitializeLegacyLocalization();
            SocialAPI.Initialize();
            VMain.dedServ = true;
            VMain.showSplash = false;
            miInitialize = typeof(Terraria.Main).GetMethod("Initialize", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
            miUpdate = typeof(Terraria.Main).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
            miInitialize.Invoke(game, null);
            Console.WriteLine("[boot] Initialize done");

            WorldFileData wfd = WorldFile.GetAllMetadata(Path.GetFullPath(worldPath), false);
            wfd.SetAsActive();
            Console.WriteLine("[boot] world: " + wfd.Path);
            var task = WorldGen.serverLoadWorld();
            while (!task.IsCompleted) Thread.Sleep(25);
            if (WorldGen.loadFailed) { Console.WriteLine("[boot] LOAD FAILED: " + WorldFile.LastThrownLoadException); return 2; }
            Console.WriteLine("[boot] world loaded; spawn=(" + VMain.spawnTileX + "," + VMain.spawnTileY + ") surface=" + VMain.worldSurface);

            VMain.myPlayer = 255;
            VMain.netMode = 2;
            VMain.gameMenu = false;
            VMain.dayTime = true; VMain.time = 27000.0;

            p = new Player();
            p.whoAmI = 0;
            VMain.player[0] = p;
            p.active = true;
            p.Spawn(PlayerSpawnContext.SpawningIntoWorld);
            Console.WriteLine("[boot] player spawned at " + p.position);

            flatCx = VMain.spawnTileX;
            Flatten("setup");
            // pre-roll a few world ticks so tile edits settle
            ResetToGround();
            for (int i = 0; i < 30; i++) { NoInput(); Tick(); }

            // ---------- S1: full-hold ground jump ----------
            ClearEquip();
            ResetToGround();
            Settle(20, "S1");
            float y0 = p.position.Y;
            float apex = y0;
            for (int t = 0; t < 140; t++)
            {
                NoInput(); p.controlJump = true;
                Tick();
                if (p.position.Y < apex) apex = p.position.Y;
                Rec("S1", t, t == 0 ? "PRESS" : "");
                if (t > 20 && p.velocity.Y == 0f) break;
            }
            Console.WriteLine("[S1] fullhold apex=" + (y0 - apex).ToString("F2") + "px = " + ((y0 - apex) / 16f).ToString("F2") + " tiles");

            // ---------- S2: tap jump ----------
            ClearEquip();
            ResetToGround();
            Settle(20, "S2");
            for (int t = 0; t < 140; t++)
            {
                NoInput(); if (t == 0) p.controlJump = true;
                Tick();
                Rec("S2", t, t == 0 ? "TAP" : "");
                if (t > 20 && p.velocity.Y == 0f) break;
            }

            // ---------- S3: Blizzard bottle mid-air double jump (full hold) ----------
            ClearEquip();
            p.armor[5] = Give(ItemID.BlizzardinaBottle);
            ResetToGround();
            Settle(20, "S3");
            for (int t = 0; t < 200; t++)
            {
                NoInput();
                if (t == 0) p.controlJump = true;                 // first jump (tap)
                if (t >= 20) p.controlJump = true;                // mid-air re-press -> bottle arm, then hold
                Tick();
                Rec("S3", t, t == 0 ? "JUMP1" : (t == 20 ? "BOTTLE" : ""));
                if (t > 60 && p.velocity.Y == 0f) break;
            }

            // ---------- S4: psycho knife held, stealth, run right ----------
            ClearEquip();
            p.inventory[0] = Give(ItemID.PsychoKnife);
            p.selectedItemState.Select(0);
            ResetToGround();
            for (int t = 0; t < 240; t++) { NoInput(); Tick(); if (t % 60 == 0) Rec("S4a", t, "stealth-build"); }
            for (int t = 0; t < 160; t++)
            {
                NoInput(); p.controlRight = true;
                Tick();
                Rec("S4b", t, "run");
            }

            // ---------- S5: pogo stick (mount 43) air friction ----------
            ClearEquip();
            ResetToGround();
            p.mount.SetMount(43, p);
            Settle(20, "S5");
            for (int t = 0; t < 80; t++) { NoInput(); p.controlRight = true; Tick(); if (t % 20 == 0) Rec("S5a", t, "runup"); }
            for (int t = 0; t < 90; t++)
            {
                NoInput();
                if (t == 0) p.controlJump = true;   // hop into air
                Tick();
                Rec("S5b", t, t == 0 ? "HOP" : "");
                if (t > 10 && p.velocity.Y == 0f) break;
            }

            // ---------- S6: flying carpet horizontal + vy pin ----------
            ClearEquip();
            p.armor[3] = Give(ItemID.FlyingCarpet);
            ResetToGround();
            Settle(20, "S6");
            for (int t = 0; t < 260; t++)
            {
                NoInput();
                p.controlRight = true;
                if (t < 3) p.controlJump = true;      // brief hop (jump budget released at t=3)
                if (t >= 25) p.controlJump = true;    // re-press mid-air (falling) -> carpet
                Tick();
                Rec("S6", t, t == 0 ? "JUMP" : (t == 25 ? "CARPET-ON" : ""));
            }

            // ---------- S7: rocket boots + Dead Cells down-dash (ignition gate) ----------
            // S7: fall from height, trigger down-dash mid-fall, re-press DURING the dash.
            //     Vanilla must REFUSE rocket ignition (CanUseBootFlyingAbilities = !downDash).
            ClearEquip();
            p.armor[3] = Give(ItemID.RocketBoots);
            p.armor[4] = Give(5465); // Dead Cells Ram Rune (hasDeadCellsDownDash)
            ResetToGround();
            p.position = new Vector2(groundPos.X, groundPos.Y - 560f);
            Settle(20, "S7");
            for (int t = 0; t < 120; t++)
            {
                NoInput();
                if (t == 20) { p.controlJump = true; p.controlDown = true; }   // down-dash trigger mid-fall
                if (t >= 21 && t < 26) { p.controlJump = false; p.controlDown = true; }
                if (t == 26) p.controlJump = true;          // re-press DURING down-dash
                if (t > 26) { p.controlJump = true; p.controlDown = true; }
                Tick();
                Rec("S7", t, t == 20 ? "DOWNDASH" : (t == 26 ? "REPRESS" : ""));
                if (t > 30 && p.velocity.Y == 0f) break;
            }
            // S7b control: identical fall WITHOUT down-dash -> re-press MUST ignite.
            ResetToGround();
            p.position = new Vector2(groundPos.X, groundPos.Y - 560f);
            Settle(20, "S7b");
            for (int t = 0; t < 120; t++)
            {
                NoInput();
                if (t == 26) p.controlJump = true;
                if (t > 26) p.controlJump = true;
                Tick();
                Rec("S7b", t, t == 26 ? "REPRESS-NODASH" : "");
                if (t > 30 && p.velocity.Y == 0f) break;
            }

            // ---------- S8: merman + lava shark (49) hover in water, hold jump ----------
            ClearEquip();
            p.armor[6] = Give(ItemID.NeptunesShell);
            FillBasin();
            ResetToGround();
            // settle in water: drop player into basin
            p.position = new Vector2(flatCx * 16f + 8f, (groundRow + 46) * 16f);
            for (int t = 0; t < 120; t++) { NoInput(); Tick(); if (t % 30 == 0) Rec("S8a", t, "transform"); }
            p.mount.SetMount(49, p);
            for (int t = 0; t < 60; t++) { NoInput(); Tick(); if (t % 20 == 0) Rec("S8b", t, "mounted"); }
            for (int t = 0; t < 200; t++)
            {
                NoInput(); p.controlJump = true;
                Tick();
                Rec("S8c", t, "holdjump");
            }

            // control: same water + mount WITHOUT hold-jump (swimTime drain baseline)
            ResetToGround();
            p.position = new Vector2(flatCx * 16f + 8f, (groundRow + 46) * 16f);
            p.mount.SetMount(49, p);
            for (int t = 0; t < 60; t++) { NoInput(); Tick(); if (t % 20 == 0) Rec("S8d", t, "baseline"); }

            }
            catch (Exception ex)
            {
                Console.WriteLine("[FATAL] " + ex);
                return 3;
            }
            File.WriteAllText(outPath,
                "scen\tt\tpx\tpy\tvx\tvy\tjump\tjumpHeight\tjumpSpeed\tgravity\tmaxFall\tmaxRun\trunAcc\trunSlow\taccRun\tcarpetFrame\trocketTime\trocketDelay\trocketDelay2\twingTime\tstealth\twet\tmerman\tswimTime\tmountType\tctlJump\tctlDown\tctlRight\tnote\n" + tsv.ToString());
            Console.WriteLine("[done] wrote " + outPath);
            return 0;
        }

    }
}
