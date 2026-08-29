// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/modal

    document.addEventListener("DOMContentLoaded", function () {
        const modalSystem = ((window.lumos ??= {}).modal ??= {
            list: {}, open(id) { this.list[id]?.open?.(); }, closeAll() { Object.values(this.list).forEach((m) => { if (m.el?.open) m.close?.(); }); },
        });
        function getDismissedDialog(target) {
            if (!target.closest("[data-modal-close]")) return;
            for (let element = target; element; element = element.parentElement) {
                if (element.matches(".modal_dialog") && element.dataset.scriptInitialized) return element;
            }
        }
        function createModals() {
            document.querySelectorAll(".modal_dialog").forEach(function (modal) {
                if (modal.dataset.scriptInitialized) return;
                modal.dataset.scriptInitialized = "true";
    
                const modalId = modal.getAttribute("data-modal-target");
                const variant = modal.getAttribute("data-wf--modal--variant");
                let lastFocusedElement;
    
                if (typeof gsap !== "undefined") {
                    gsap.context(() => {
                        let tl = gsap.timeline({ paused: true, onReverseComplete: resetModal });
                        if (variant === "side-panel") {
                            tl.fromTo(".modal_backdrop", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" });
                            tl.from(".modal_content", { xPercent: 100, duration: 0.3, ease: "power1.out" }, "<");
                        } else if (variant === "full-screen") {
                            tl.set(".modal_backdrop", { opacity: 0 });
                            tl.from(".modal_content", { opacity: 0, duration: 0.2, ease: "power1.out" });
                            tl.from(".modal_slot", { opacity: 0, y: "2rem", duration: 0.2, ease: "power1.out" }, "<0.1");
                        } else {
                            tl.fromTo(".modal_backdrop", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" });
                            tl.from(".modal_content", { opacity: 0, y: "6rem", duration: 0.3, ease: "power1.out" }, "<");
                        }
                        modal.tl = tl;
                    }, modal);
                }
    
                function resetModal() {
                    typeof lenis !== "undefined" && lenis.start ? lenis.start() : (document.body.style.overflow = "");
                    modal.close();
                    // A close at progress 0 skips the reverse, so without this the entrance keeps
                    // playing on the now-hidden dialog and parks at 1 — and the next open's play()
                    // becomes a no-op, snapping the modal in fully opaque. gsap suppresses callbacks
                    // when progress is set, so rewinding here cannot re-enter onReverseComplete.
                    if (modal.tl) modal.tl.pause().progress(0);
                    if (lastFocusedElement) lastFocusedElement.focus();
                    window.dispatchEvent(new CustomEvent("modal-close", { detail: { modal } }));
                }
                function openModal() {
                    typeof lenis !== "undefined" && lenis.stop ? lenis.stop() : (document.body.style.overflow = "hidden");
                    lastFocusedElement = document.activeElement;
                    // Re-opening an already-open modal dialog is a no-op by spec: showModal()
                    // returns at step 1 when the dialog is already modal, so this is safe to
                    // call on a dialog the visitor is already looking at.
                    modal.showModal();
                    // play() on a timeline that is mid-reverse is what CANCELS the pending
                    // close, so a dialog re-entered during its 300ms fade-out stays open
                    // instead of completing the close underneath the visitor.
                    //
                    // Do NOT add an `if (modal.open) return` guard above: it reads like a
                    // cheap early-out, but it would skip this play() and let the reverse run
                    // to completion, wiping a dialog the visitor had just re-entered.
                    if (typeof gsap !== "undefined" && modal.tl) modal.tl.play();
                    modal.querySelectorAll("[data-modal-scroll]").forEach((el) => (el.scrollTop = 0));
                    window.dispatchEvent(new CustomEvent("modal-open", { detail: { modal } }));
                }
                function closeModal() {
                    typeof gsap !== "undefined" && modal.tl && modal.tl.progress() ? modal.tl.reverse() : resetModal();
                }
    
                if (new URLSearchParams(location.search).get("modal-id") === modalId) openModal(), history.replaceState({}, "", ((u) => (u.searchParams.delete("modal-id"), u))(new URL(location.href)));
                modal.addEventListener("cancel", (e) => (e.preventDefault(), closeModal()));
                modal.addEventListener("click", (e) => {
                    // An adopted nested dialog owns its own close controls; anything else (this dialog,
                    // an un-adopted inner dialog, a dismiss wrapper above us) closes this one.
                    if (getDismissedDialog(e.target) !== modal) return;
                    const href = e.target.closest("a")?.getAttribute("href");
                    // Real links and section anchors still navigate; only hrefs the modal system owns
                    // are suppressed (an empty href would reload the page).
                    if (href === "" || href === "#" || (href?.startsWith("#") && Object.prototype.hasOwnProperty.call(modalSystem.list, href.slice(1)))) e.preventDefault();
                    closeModal();
                });
                document.addEventListener("click", (e) => {
                    const trigger = e.target.closest(`[data-modal-trigger='${modalId}'], a[href='#${modalId}']`);
                    if (!trigger) return;
                    if (trigger.tagName === "A") e.preventDefault();
                    // A close control must not reopen the modal it dismisses — keyed by target name so
                    // CMS-duplicated dialogs are all covered. Naming a DIFFERENT modal is the authored
                    // hand-off (the booking chooser) and still opens it.
                    if (getDismissedDialog(e.target)?.getAttribute("data-modal-target") === modalId) return;
                    openModal();
                });
                modalSystem.list[modalId] = { open: openModal, close: closeModal, el: modal };
            });
            if (!modalSystem.closeAllBound) {
                modalSystem.closeAllBound = true;
                document.addEventListener("click", (e) => {
                    const trigger = e.target.closest("[data-close-all-modals]");
                    if (!trigger) return;
                    if (trigger.tagName === "A") e.preventDefault();
                    modalSystem.closeAll();
                });
            }
        }
        modalSystem.init = createModals;
        createModals();
    });
