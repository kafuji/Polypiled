import { afterAll, expect, it, vi } from "vitest";
vi.hoisted(()=>vi.stubGlobal("window",{location:new URL("http://localhost"),matchMedia:()=>({matches:false,addEventListener(){}})}));
import { HeldWeapon } from "./held-weapon";
afterAll(()=>vi.unstubAllGlobals());
it("resolves active hands without treating an unwielded alternate weapon as the off hand",()=>{
 const right={text:'a sword (weapon in hand)'},left={text:'a dagger (wielded in other hand)'},alternate={text:'a mace (alternate weapon; not wielded)'};
 const held=Object.create(HeldWeapon.prototype);held.dependencies={menuPreviews:{currentInventoryState:()=>null},promptDialogs:{currentInventory:[alternate,left,right]}};
 expect(held.findHeldWeaponInventoryItem('right')).toBe(right);expect(held.findHeldWeaponInventoryItem('left')).toBe(left);expect(held.findHeldWeaponInventoryItem()).toBe(right);
 held.dependencies.promptDialogs.currentInventory=[alternate,{text:'a sword (weapon in left hand)'}];
 expect(held.findHeldWeaponInventoryItem('left')?.text).toContain('left hand');expect(held.findHeldWeaponInventoryItem('right')).toBeNull();
});
it("takes the hands from the core's inventory state when it is there",()=>{
 const object=(id:number,name:string,wornMask:number)=>({id,letter:String.fromCharCode(96+id),name,glyph:1000+id,tileIndex:id,wornMask});
 let state:any={twoWeapon:false,objects:[object(1,'a katana (weapon in hand)',0x100),object(2,'a short sword (alternate weapon; not wielded)',0x400)]};
 const held=Object.create(HeldWeapon.prototype);held.dependencies={menuPreviews:{currentInventoryState:()=>state},promptDialogs:{currentInventory:[{text:'a stale mace (weapon in hand)'}]}};
 expect(held.findHeldWeaponInventoryItem()?.tileIndex).toBe(1);expect(held.findHeldWeaponInventoryItem('left')).toBeNull();
 state={...state,twoWeapon:true};
 expect(held.findHeldWeaponInventoryItem('right')?.text).toContain('katana');expect(held.findHeldWeaponInventoryItem('left')?.tileIndex).toBe(2);
 state={twoWeapon:false,objects:[]};
 expect(held.findHeldWeaponInventoryItem()).toBeNull();
});
