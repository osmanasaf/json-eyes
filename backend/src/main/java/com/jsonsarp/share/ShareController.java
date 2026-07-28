package com.jsonsarp.share;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/shares")
public class ShareController {

    private final ShareService shareService;

    public ShareController(ShareService shareService) {
        this.shareService = shareService;
    }

    @PostMapping
    public ShareCreateResponse create(@RequestBody ShareCreateRequest request) {
        return shareService.createShare(request);
    }

    @GetMapping("/{id}")
    public ShareResponse get(@PathVariable String id) {
        return shareService.getShare(id);
    }
}
